// Outreach service (Phase 6): sends one approved draft through the Gmail adapter and tracks replies.
//
// Send safety, in order:
//   1. Idempotency key: a repeated request (double click, browser/server retry) returns the record
//      of the first request and never calls Gmail again.
//   2. Eligibility from STORED data: draft exists, belongs to the company, is approved; recipient is
//      a stored contact with a valid email; Gmail is connected; the draft has no in-flight, sent or
//      unresolved send (also enforced by a UNIQUE partial index).
//   3. A "sending" record is written BEFORE Gmail is called (same synchronous step as the checks,
//      so two concurrent requests cannot both pass).
//   4. Outcome: confirmed → snapshot + Gmail ids + CRM update in one transaction; definite failure →
//      "failed", CRM untouched; unknown (timeout, 5xx) → "ambiguous": never retried automatically,
//      Berk reconciles (looks the message up in Gmail) or marks it as not sent.
//
// Follow ups (Phase 7) reuse exactly this path (idempotency key, "sending" record, UNIQUE active send
// per draft, ambiguous handling) with three additions: the planner must confirm the step is approved,
// due and unblocked; a live read only check of the Gmail thread runs immediately before sending (a
// new reply is stored, stops the sequence and blocks the send); and the message is sent into the
// original thread (threadId + In-Reply-To/References + the original subject).
import { createHash } from 'node:crypto';
import type { Company } from '../../src/domain/company';
import {
  blockingSend,
  isValidEmail,
  OUTREACH_ERROR_MESSAGES,
  type GmailStatusResponse,
  type OutboundMessage,
  type OutreachErrorCode,
  type SyncRun,
  type ThreadMessage,
} from '../../src/domain/outreach';
import { createId } from '../../src/lib/id';
import { actionMeta } from '../../src/state/companies/companyCommands';
import { companiesReducer, type CompaniesAction } from '../../src/state/companies/companiesReducer';
import type { Store } from '../db/store';
import { GmailError, type GmailErrorCode, type GmailProviderAdapter, type GmailThreadMessage, type SentRef } from '../gmail/types';
import { FollowUpError, type FollowUpPlanner } from '../followUp/service';

export const INTERRUPTED_SEND_MESSAGE = "Gönderim sırasında sunucu durdu; mailin gidip gitmediği belirsiz. Gmail'de kontrol et.";
export const INTERRUPTED_SYNC_MESSAGE = 'Yanıt kontrolü sunucu yeniden başlatıldığı için yarıda kaldı.';

const HTTP: Record<OutreachErrorCode, number> = {
  gmail_not_configured: 503,
  gmail_not_connected: 409,
  gmail_reconnect: 409,
  credentials_key_missing: 503,
  credentials_unreadable: 409,
  oauth_state: 400,
  oauth_denied: 400,
  oauth_failed: 502,
  draft_not_found: 404,
  draft_not_approved: 409,
  draft_company_mismatch: 400,
  recipient_missing: 400,
  recipient_invalid: 400,
  already_sent: 409,
  send_in_progress: 409,
  needs_review: 409,
  send_rejected: 502,
  send_ambiguous: 504,
  rate_limit: 429,
  not_ambiguous: 409,
  gmail_unavailable: 503,
  sync_running: 409,
  sync_failed: 502,
};

export class OutreachError extends Error {
  readonly status: number;
  constructor(
    public readonly code: OutreachErrorCode,
    /** Extra JSON for the client (e.g. the stored send record of a failed or unclear send). */
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(OUTREACH_ERROR_MESSAGES[code]);
    this.name = 'OutreachError';
    this.status = HTTP[code];
  }
}

/** GmailError → the Turkish error Berk sees. */
export function outreachCodeFor(code: GmailErrorCode): OutreachErrorCode {
  switch (code) {
    case 'not_connected':
      return 'gmail_not_connected';
    case 'reconnect':
      return 'gmail_reconnect';
    case 'key_missing':
      return 'credentials_key_missing';
    case 'unreadable':
      return 'credentials_unreadable';
    case 'oauth_state':
    case 'oauth_denied':
    case 'oauth_failed':
      return code;
    case 'rejected':
      return 'send_rejected';
    case 'rate_limit':
      return 'rate_limit';
    case 'ambiguous':
      return 'send_ambiguous';
    case 'unavailable':
      return 'gmail_unavailable';
  }
}

/** Fingerprint of the approved draft revision (what Berk approved, exactly). */
export function revisionKey(d: { id: string; approvedAt: string | null; selectedSubject: string; body: string }): string {
  return createHash('sha256').update(JSON.stringify([d.id, d.approvedAt, d.selectedSubject, d.body])).digest('hex');
}

/**
 * Whether a message in a KITE thread is a reply to store.
 *
 * Never: KITE's own sends (stored Gmail ids) and Gmail drafts.
 * Explicit reply: sent by the stored recipient AND addressed (To/Cc) to the connected account. This
 * counts even when Gmail also labels it SENT, which happens when the recipient address is one of
 * the connected mailbox's own identities (alias): `SENT` alone is not proof of an own message.
 * Otherwise: anything Gmail labels SENT or that comes from the connected account is Berk's own
 * (manual replies, alias self-chatter not addressed back to the account) and is not a reply.
 */
export function isInboundReply(
  m: Pick<GmailThreadMessage, 'id' | 'labelIds' | 'from' | 'to' | 'cc'>,
  ctx: { ownIds: ReadonlySet<string>; account: string; send: Pick<OutboundMessage, 'recipientEmail'> },
): boolean {
  if (ctx.ownIds.has(m.id) || m.labelIds.includes('DRAFT')) return false;
  const from = m.from.email.trim().toLowerCase();
  if (!from) return false;
  const account = ctx.account.trim().toLowerCase();
  const addressedToAccount = !!account && [...m.to, ...m.cc].some((a) => a.trim().toLowerCase() === account);
  if (from === ctx.send.recipientEmail.trim().toLowerCase() && addressedToAccount) return true;
  return !m.labelIds.includes('SENT') && from !== account;
}

export interface SendRequest {
  draftId: string;
  companyId: string;
  contactId: string;
  idempotencyKey: string;
}

export interface SendOutcome {
  send: OutboundMessage;
  company: Company;
  /** True when this request repeated an earlier one (nothing was sent again). */
  replayed: boolean;
  /**
   * Set when Gmail confirmed a first contact but its follow up plan could not be saved. The send is
   * recorded correctly; Berk can create the plan with "Takip Planı Oluştur".
   */
  followUpWarning?: string;
}

export const FOLLOW_UP_SETUP_WARNING = "Mail gönderildi, ancak takip planı oluşturulamadı. Mail & Takip'te “Takip Planı Oluştur” ile elle oluşturabilirsin.";

export interface FollowUpSendRequest {
  stepId: string;
  idempotencyKey: string;
}

export function createOutreachService(store: Store, gmail: GmailProviderAdapter | null, deps: { now?: () => Date; followUps?: FollowUpPlanner | null } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const followUps = deps.followUps ?? null;
  let syncing = false;

  function companyOrThrow(id: string): Company {
    const c = store.companies.get(id);
    if (!c) throw new OutreachError('draft_company_mismatch');
    return c;
  }

  function applyCompany(id: string, make: (meta: ReturnType<typeof actionMeta>) => CompaniesAction, at: string): Company {
    const current = companyOrThrow(id);
    const [next] = companiesReducer([current], make(actionMeta(at)));
    if (next !== current) store.companies.save(next);
    return next;
  }

  async function connectedAccount(): Promise<{ adapter: GmailProviderAdapter; email: string | null }> {
    if (!gmail || !gmail.configured) throw new OutreachError('gmail_not_configured');
    const c = await gmail.connection();
    if (c.state === 'disconnected') throw new OutreachError('gmail_not_connected');
    if (c.state === 'error') throw new OutreachError(outreachCodeFor(c.error ?? 'not_connected'));
    return { adapter: gmail, email: c.email };
  }

  /**
   * Confirmed send: snapshot ids, KITE's own thread message and the CRM update, atomically. A
   * follow up also marks its step sent and schedules the next one; a first contact also gets its
   * follow up plan (in a savepoint: a plan failure never makes a confirmed send look unsent).
   */
  function recordSuccess(send: OutboundMessage, ref: SentRef, at: string, resolution: OutboundMessage['resolution']): SendOutcome {
    return store.transaction(() => {
      const sent: OutboundMessage = {
        ...send,
        status: 'sent',
        gmailMessageId: ref.messageId,
        gmailThreadId: ref.threadId,
        rfcMessageId: ref.rfcMessageId,
        errorCode: null,
        errorMessage: null,
        resolution,
        sentAt: at,
        updatedAt: at,
      };
      store.outreach.updateOutcome(sent);
      if (!store.outreach.hasMessage(ref.messageId)) {
        store.outreach.insertMessage({
          id: createId('msg'),
          outboundId: sent.id,
          companyId: sent.companyId,
          gmailThreadId: ref.threadId,
          gmailMessageId: ref.messageId,
          rfcMessageId: ref.rfcMessageId,
          direction: 'outbound',
          fromEmail: sent.fromEmail ?? '',
          fromName: null,
          to: [sent.recipientEmail],
          cc: [],
          subject: sent.subject,
          bodyText: sent.body,
          snippet: sent.body.slice(0, 160),
          messageAt: at,
          syncedAt: at,
          attachments: [],
        });
      }
      const draft = store.mail.get(sent.draftId);
      if (draft?.kind === 'follow_up' && draft.followUp) {
        followUps?.recordSent(draft, sent, at);
        const company = applyCompany(sent.companyId, (meta) => ({ type: 'followUpSent', id: sent.companyId, step: draft.followUp!.stepNumber, recipient: sent.recipientEmail, sentAt: at, meta }), at);
        return { send: sent, company, replayed: false };
      }
      let company = applyCompany(sent.companyId, (meta) => ({ type: 'emailSent', id: sent.companyId, recipient: sent.recipientEmail, subject: sent.subject, sentAt: at, meta }), at);
      let followUpWarning: string | undefined;
      if (followUps) {
        const plan = store.savepoint(() => followUps.createAutomatic(sent, at));
        if (!plan.ok) {
          console.error('[followup] plan could not be created after a confirmed send:', plan.error instanceof Error ? plan.error.message : plan.error);
          followUpWarning = FOLLOW_UP_SETUP_WARNING;
        } else if (plan.value) {
          company = store.companies.get(sent.companyId) ?? company;
        }
      }
      return { send: sent, company, replayed: false, ...(followUpWarning ? { followUpWarning } : {}) };
    });
  }

  /**
   * Stores the not-yet-seen genuine replies of one thread (Phase 6 rules incl. the alias fix) and
   * applies the reply status rule; any new reply also ends the thread's follow up sequences. One
   * transaction. Used by "Yanıtları Kontrol Et" and by the pre-send check of every follow up.
   */
  function ingestThread(threadId: string, send: OutboundMessage, messages: GmailThreadMessage[], ownIds: ReadonlySet<string>, account: string): { newMessages: ThreadMessage[]; companies: Map<string, Company> } {
    const at = now();
    const newMessages: ThreadMessage[] = [];
    const changed = new Map<string, Company>();
    store.transaction(() => {
      for (const m of messages) {
        if (m.threadId !== threadId || store.outreach.hasMessage(m.id)) continue;
        if (!isInboundReply(m, { ownIds, account, send })) continue;
        const message: ThreadMessage = {
          id: createId('msg'),
          outboundId: send.id,
          companyId: send.companyId,
          gmailThreadId: threadId,
          gmailMessageId: m.id,
          rfcMessageId: m.rfcMessageId,
          direction: 'inbound',
          fromEmail: m.from.email,
          fromName: m.from.name,
          to: m.to,
          cc: m.cc,
          subject: m.subject,
          bodyText: m.bodyText,
          snippet: m.snippet,
          messageAt: m.messageAt,
          syncedAt: at,
          attachments: m.attachments,
        };
        store.outreach.insertMessage(message);
        newMessages.push(message);
        const from = m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
        changed.set(send.companyId, applyCompany(send.companyId, (meta) => ({ type: 'replyReceived', id: send.companyId, from, meta }), at));
      }
      if (newMessages.length && followUps) {
        followUps.onReplyStored(threadId, at);
        changed.set(send.companyId, companyOrThrow(send.companyId));
      }
    });
    return { newMessages, companies: changed };
  }

  const ownMessageIds = () => new Set(store.outreach.listThreadSends().map((s) => s.gmailMessageId).filter(Boolean) as string[]);

  function recordFailure(send: OutboundMessage, status: 'failed' | 'ambiguous', code: OutreachErrorCode): OutboundMessage {
    const at = now();
    const next: OutboundMessage = { ...send, status, errorCode: code, errorMessage: OUTREACH_ERROR_MESSAGES[code], updatedAt: at };
    store.outreach.updateOutcome(next);
    return next;
  }

  async function status(verify: boolean): Promise<GmailStatusResponse> {
    const lastSync = store.outreach.lastSyncRun();
    const lastSuccessfulSyncAt = store.outreach.lastSuccessfulSyncRun()?.finishedAt ?? null;
    if (!gmail) return { provider: null, state: 'not_configured', email: null, connectedAt: null, lastSync, lastSuccessfulSyncAt, error: null };
    if (!gmail.configured) {
      return { provider: gmail.kind, state: 'not_configured', email: null, connectedAt: null, lastSync, lastSuccessfulSyncAt, error: null };
    }
    const c = verify ? await gmail.verify() : await gmail.connection();
    const errorCode = c.state === 'error' ? outreachCodeFor(c.error ?? 'not_connected') : null;
    return {
      provider: gmail.kind,
      state: c.state,
      email: c.email,
      connectedAt: c.connectedAt,
      lastSync,
      lastSuccessfulSyncAt,
      error: errorCode ? { code: errorCode, message: OUTREACH_ERROR_MESSAGES[errorCode] } : null,
    };
  }

  return {
    status: () => status(false),
    verify: () => status(true),

    beginConnect(): { authUrl: string; state: string } {
      if (!gmail || !gmail.configured) throw new OutreachError('gmail_not_configured');
      return gmail.beginAuthorization();
    },

    async completeConnect(params: { code?: string | null; state?: string | null; error?: string | null; stateBound?: boolean }): Promise<{ email: string }> {
      if (!gmail || !gmail.configured) throw new OutreachError('gmail_not_configured');
      try {
        return await gmail.completeAuthorization(params);
      } catch (e) {
        if (e instanceof GmailError) throw new OutreachError(outreachCodeFor(e.code), { detail: e.detail });
        throw e;
      }
    },

    async disconnect(): Promise<GmailStatusResponse> {
      if (gmail?.configured) await gmail.disconnect();
      return status(false);
    },

    list(): { sends: OutboundMessage[]; messages: ThreadMessage[] } {
      return { sends: store.outreach.listSends(), messages: store.outreach.listMessages() };
    },

    async send(request: SendRequest): Promise<SendOutcome> {
      const replay = () => {
        const prior = store.outreach.findByIdempotencyKey(request.idempotencyKey);
        if (!prior) return null;
        if (prior.draftId !== request.draftId) throw new OutreachError('draft_company_mismatch');
        return { send: prior, company: companyOrThrow(prior.companyId), replayed: true };
      };
      const early = replay();
      if (early) return early;

      const { adapter, email: fromEmail } = await connectedAccount();

      // Checks and the "sending" record happen in one synchronous transaction: no await in between,
      // so a concurrent duplicate request sees the record and stops.
      const pending = store.transaction((): SendOutcome | OutboundMessage => {
        const again = replay();
        if (again) return again;
        const draft = store.mail.get(request.draftId);
        if (!draft) throw new OutreachError('draft_not_found');
        if (draft.kind === 'follow_up') throw new OutreachError('draft_not_found');
        if (draft.companyId !== request.companyId) throw new OutreachError('draft_company_mismatch');
        if (draft.status !== 'approved' || !draft.approvedAt) throw new OutreachError('draft_not_approved');
        const company = companyOrThrow(request.companyId);
        const contact = company.contacts.find((c) => c.id === request.contactId);
        if (!contact) throw new OutreachError('recipient_missing');
        if (!isValidEmail(contact.email)) throw new OutreachError('recipient_invalid');
        const blocking = blockingSend(store.outreach.listSendsForDraft(draft.id), draft.id);
        if (blocking) throw new OutreachError(blocking.status === 'sent' ? 'already_sent' : blocking.status === 'sending' ? 'send_in_progress' : 'needs_review', { send: blocking });
        const at = now();
        const send: OutboundMessage = {
          id: createId('snd'),
          companyId: company.id,
          draftId: draft.id,
          contactId: contact.id,
          recipientEmail: contact.email.trim(),
          recipientName: contact.fullName || null,
          fromEmail,
          subject: draft.selectedSubject,
          body: draft.body,
          service: draft.service,
          language: draft.language,
          revisionKey: revisionKey(draft),
          provider: adapter.kind,
          status: 'sending',
          gmailMessageId: null,
          gmailThreadId: null,
          rfcMessageId: null,
          errorCode: null,
          errorMessage: null,
          resolution: null,
          attemptedAt: at,
          sentAt: null,
          createdAt: at,
          updatedAt: at,
        };
        store.outreach.insertSend(send, request.idempotencyKey);
        return send;
      });
      if ('replayed' in pending) return pending;
      const send = pending;

      let ref: SentRef;
      try {
        ref = await adapter.send({ sendId: send.id, to: { email: send.recipientEmail, name: send.recipientName }, subject: send.subject, body: send.body });
      } catch (e) {
        // Anything that is not a definite Gmail failure is treated as "unknown": never assume unsent.
        const code: GmailErrorCode = e instanceof GmailError ? e.code : 'ambiguous';
        if (!(e instanceof GmailError)) console.error('[gmail] unexpected send error:', e instanceof Error ? e.message : e);
        else console.warn(`[gmail] send ${send.id} ${code}${e.detail ? ` (${e.detail})` : ''}`);
        const outreachCode = outreachCodeFor(code);
        const stored = recordFailure(send, code === 'ambiguous' ? 'ambiguous' : 'failed', outreachCode);
        throw new OutreachError(outreachCode, { send: stored });
      }
      try {
        return recordSuccess(send, ref, now(), null);
      } catch (e) {
        // Gmail sent it but saving failed: never leave it looking unsent. The record becomes
        // "ambiguous" (if the database still accepts writes; otherwise startup recovery does it),
        // and reconcile will find the message by its send id.
        console.error('[outreach] sent but not recorded:', e instanceof Error ? e.message : e);
        try {
          recordFailure(send, 'ambiguous', 'send_ambiguous');
        } catch {
          /* recovered on next start */
        }
        throw e;
      }
    },

    /**
     * Sends ONE approved, due follow up into its original Gmail thread. Only called from Berk's
     * explicit confirmation ("Bu Takip Mailini Gönder"). Order:
     *   1. idempotency replay (a repeated request never reaches Gmail again)
     *   2. planner check from stored data (approved, due, active, not blocked, follow ups on)
     *   3. live read only check of the thread: a new reply is stored, the sequence stops, no send;
     *      a failed check also means no send
     *   4. same checks again + "sending" record in one synchronous transaction (no double send)
     *   5. Gmail send with threadId, In-Reply-To, References and the original subject
     */
    async sendFollowUp(request: FollowUpSendRequest): Promise<SendOutcome> {
      if (!followUps) throw new FollowUpError('followup_disabled');
      const planner = followUps;
      const replay = (draftId: string | null) => {
        const prior = store.outreach.findByIdempotencyKey(request.idempotencyKey);
        if (!prior) return null;
        if (draftId && prior.draftId !== draftId) throw new OutreachError('draft_company_mismatch');
        return { send: prior, company: companyOrThrow(prior.companyId), replayed: true };
      };
      const stepDraft = store.followUps.getStep(request.stepId)?.draftId ?? null;
      const early = replay(stepDraft);
      if (early) return early;

      const { adapter, email } = await connectedAccount();
      const target = planner.sendTarget(request.stepId);
      const { seq } = target;
      const initial = store.outreach.getSend(seq.initialOutboundMessageId);
      if (!initial) throw new FollowUpError('followup_not_found');

      // Live thread check: the prospect may have replied since the last "Yanıtları Kontrol Et".
      let live: GmailThreadMessage[];
      try {
        live = await adapter.getThread(seq.gmailThreadId);
      } catch (e) {
        console.warn(`[followup] pre-send thread check failed: ${e instanceof GmailError ? e.code : 'error'}`);
        throw new FollowUpError('followup_check_failed', { detail: e instanceof GmailError ? e.code : 'error' });
      }
      const ingested = ingestThread(seq.gmailThreadId, initial, live, ownMessageIds(), (email ?? '').toLowerCase());
      if (ingested.newMessages.length > 0 || store.outreach.listThreadMessages(seq.gmailThreadId).some((m) => m.direction === 'inbound')) {
        throw new FollowUpError('followup_reply_found', { newMessages: ingested.newMessages, companies: [...ingested.companies.values()] });
      }

      // Threading headers from the stored sends of this conversation; a Message-ID KITE could not
      // read at send time is taken from the live thread (same Gmail message id).
      const sends = store.outreach.listSendsInThread(seq.gmailThreadId);
      const rfcOf = (s: OutboundMessage) => s.rfcMessageId ?? live.find((m) => m.id === s.gmailMessageId)?.rfcMessageId ?? null;
      const references = sends.map(rfcOf).filter((r): r is string => !!r);
      const parent = sends.length ? rfcOf(sends[sends.length - 1]) : null;
      if (!parent) throw new FollowUpError('followup_thread_headers');

      const pending = store.transaction((): SendOutcome | OutboundMessage => {
        const again = replay(target.draft.id);
        if (again) return again;
        const { draft } = planner.sendTarget(request.stepId);
        const blocking = blockingSend(store.outreach.listSendsForDraft(draft.id), draft.id);
        if (blocking) throw new OutreachError(blocking.status === 'sent' ? 'already_sent' : blocking.status === 'sending' ? 'send_in_progress' : 'needs_review', { send: blocking });
        const at = now();
        const send: OutboundMessage = {
          id: createId('snd'),
          companyId: seq.companyId,
          draftId: draft.id,
          contactId: seq.contactId,
          // Recipient of the original confirmed send: never silently changed.
          recipientEmail: seq.recipientEmailSnapshot,
          recipientName: seq.recipientNameSnapshot,
          fromEmail: email,
          subject: seq.subject,
          body: draft.body,
          service: seq.service,
          language: seq.language,
          revisionKey: revisionKey(draft),
          provider: adapter.kind,
          status: 'sending',
          gmailMessageId: null,
          gmailThreadId: null,
          rfcMessageId: null,
          errorCode: null,
          errorMessage: null,
          resolution: null,
          attemptedAt: at,
          sentAt: null,
          createdAt: at,
          updatedAt: at,
        };
        store.outreach.insertSend(send, request.idempotencyKey);
        return send;
      });
      if ('replayed' in pending) return pending;
      const send = pending;

      let ref: SentRef;
      try {
        ref = await adapter.send({
          sendId: send.id,
          to: { email: send.recipientEmail, name: send.recipientName },
          subject: send.subject,
          body: send.body,
          thread: { threadId: seq.gmailThreadId, inReplyTo: parent, references },
        });
      } catch (e) {
        const code: GmailErrorCode = e instanceof GmailError ? e.code : 'ambiguous';
        if (!(e instanceof GmailError)) console.error('[gmail] unexpected follow up send error:', e instanceof Error ? e.message : e);
        else console.warn(`[gmail] follow up send ${send.id} ${code}${e.detail ? ` (${e.detail})` : ''}`);
        const outreachCode = outreachCodeFor(code);
        const stored = recordFailure(send, code === 'ambiguous' ? 'ambiguous' : 'failed', outreachCode);
        throw new OutreachError(outreachCode, { send: stored });
      }
      try {
        return recordSuccess(send, ref, now(), null);
      } catch (e) {
        console.error('[outreach] follow up sent but not recorded:', e instanceof Error ? e.message : e);
        try {
          recordFailure(send, 'ambiguous', 'send_ambiguous');
        } catch {
          /* recovered on next start */
        }
        throw e;
      }
    },

    /** Looks an unclear send up in Gmail (by X-KITE-Send-Id). Found → recorded as sent. */
    async reconcile(sendId: string): Promise<SendOutcome & { found: boolean }> {
      const send = store.outreach.getSend(sendId);
      if (!send) throw new OutreachError('draft_not_found');
      if (send.status !== 'ambiguous') throw new OutreachError('not_ambiguous', { send });
      const { adapter } = await connectedAccount();
      let ref: SentRef | null;
      try {
        ref = await adapter.findSent({ sendId: send.id, recipient: send.recipientEmail, after: send.attemptedAt });
      } catch (e) {
        if (e instanceof GmailError) throw new OutreachError(e.code === 'reconnect' ? 'gmail_reconnect' : 'sync_failed', { send });
        throw e;
      }
      if (!ref) return { send, company: companyOrThrow(send.companyId), replayed: false, found: false };
      return { ...recordSuccess(send, ref, now(), 'reconciled'), found: true };
    },

    /** Berk checked Gmail and the message is not there: frees the draft for a new, explicit attempt. */
    markNotSent(sendId: string): OutboundMessage {
      return store.transaction(() => {
        const send = store.outreach.getSend(sendId);
        if (!send) throw new OutreachError('draft_not_found');
        if (send.status !== 'ambiguous') throw new OutreachError('not_ambiguous', { send });
        const at = now();
        const next: OutboundMessage = { ...send, status: 'failed', resolution: 'marked_not_sent', errorMessage: "Gmail'de kontrol edildi; gönderilmedi olarak işaretlendi.", updatedAt: at };
        store.outreach.updateOutcome(next);
        return next;
      });
    },

    /**
     * Manual reply synchronization: reads only the Gmail threads of confirmed KITE sends, stores
     * messages not seen before (de-duplicated by Gmail message id) that are not KITE's/Berk's own,
     * and applies the reply status rule. Never downloads the rest of the mailbox.
     */
    async sync(): Promise<{ run: SyncRun; newMessages: ThreadMessage[]; companies: Company[] }> {
      const { adapter, email } = await connectedAccount();
      if (syncing) throw new OutreachError('sync_running');
      syncing = true;
      const run: SyncRun = { id: createId('sync'), startedAt: now(), finishedAt: null, status: 'running', threadsChecked: 0, newReplies: 0, errorCode: null, errorMessage: null };
      store.outreach.saveSyncRun(run);
      const newMessages: ThreadMessage[] = [];
      const changed = new Map<string, Company>();
      let failures = 0;
      let fatal: OutreachErrorCode | null = null;
      try {
        const sends = store.outreach.listThreadSends();
        const ownIds = ownMessageIds();
        const account = (email ?? '').toLowerCase();
        const byThread = new Map<string, OutboundMessage>();
        for (const s of sends) if (s.gmailThreadId && !byThread.has(s.gmailThreadId)) byThread.set(s.gmailThreadId, s);

        for (const [threadId, send] of byThread) {
          let messages;
          try {
            messages = await adapter.getThread(threadId);
          } catch (e) {
            if (e instanceof GmailError && (e.code === 'reconnect' || e.code === 'rate_limit' || e.code === 'key_missing' || e.code === 'unreadable')) {
              fatal = outreachCodeFor(e.code);
              break;
            }
            failures += 1;
            console.warn(`[gmail] sync thread failed: ${e instanceof GmailError ? e.code : 'error'}`);
            continue;
          }
          run.threadsChecked += 1;
          const result = ingestThread(threadId, send, messages, ownIds, account);
          newMessages.push(...result.newMessages);
          for (const [id, c] of result.companies) changed.set(id, c);
        }
      } catch (e) {
        console.error('[gmail] sync failed:', e instanceof Error ? e.message : e);
        fatal = 'sync_failed';
      } finally {
        syncing = false;
      }
      const finished: SyncRun = {
        ...run,
        finishedAt: now(),
        newReplies: newMessages.length,
        status: fatal ? 'failed' : failures ? 'partial' : 'ok',
        errorCode: fatal ?? (failures ? 'sync_failed' : null),
        errorMessage: fatal ? OUTREACH_ERROR_MESSAGES[fatal] : failures ? `${failures} konuşma kontrol edilemedi.` : null,
      };
      store.outreach.saveSyncRun(finished);
      if (fatal) throw new OutreachError(fatal, { run: finished, newMessages, companies: [...changed.values()] });
      return { run: finished, newMessages, companies: [...changed.values()] };
    },

    /** Startup: unfinished sends become "ambiguous" (manual review), unfinished sync runs fail. */
    recoverInterrupted(): { sends: number; syncs: number } {
      const at = now();
      return { sends: store.outreach.markInterruptedSends(INTERRUPTED_SEND_MESSAGE, at), syncs: store.outreach.markInterruptedSyncRuns(INTERRUPTED_SYNC_MESSAGE, at) };
    },
  };
}

export type OutreachService = ReturnType<typeof createOutreachService>;
