// SQLite outreach repository (Phase 6): send attempts, thread messages and sync runs. Only
// operational mail history lives here; OAuth credentials never do.
import type { MailAttachmentMeta, OutboundMessage, SyncRun, ThreadMessage } from '../../../src/domain/outreach';
import { fromJson, toJson, type Db } from '../sqlite';
import type { OutreachRepository } from './types';

type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));

const toOutbound = (r: Row): OutboundMessage => ({
  id: s(r.id),
  companyId: s(r.company_id),
  draftId: s(r.draft_id),
  contactId: sn(r.contact_id),
  recipientEmail: s(r.recipient_email),
  recipientName: sn(r.recipient_name),
  fromEmail: sn(r.from_email),
  subject: s(r.subject),
  body: s(r.body),
  service: s(r.service) as OutboundMessage['service'],
  language: s(r.language) as OutboundMessage['language'],
  revisionKey: s(r.revision_key),
  provider: s(r.provider) as OutboundMessage['provider'],
  status: s(r.status) as OutboundMessage['status'],
  gmailMessageId: sn(r.gmail_message_id),
  gmailThreadId: sn(r.gmail_thread_id),
  rfcMessageId: sn(r.rfc_message_id),
  errorCode: sn(r.error_code),
  errorMessage: sn(r.error_message),
  resolution: sn(r.resolution) as OutboundMessage['resolution'],
  attemptedAt: s(r.attempted_at),
  sentAt: sn(r.sent_at),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const toMessage = (r: Row): ThreadMessage => ({
  id: s(r.id),
  outboundId: s(r.outbound_id),
  companyId: s(r.company_id),
  gmailThreadId: s(r.gmail_thread_id),
  gmailMessageId: s(r.gmail_message_id),
  rfcMessageId: sn(r.rfc_message_id),
  direction: s(r.direction) as ThreadMessage['direction'],
  fromEmail: s(r.from_email),
  fromName: sn(r.from_name),
  to: fromJson<string[]>(r.to_json) ?? [],
  cc: fromJson<string[]>(r.cc_json) ?? [],
  subject: s(r.subject),
  bodyText: s(r.body_text),
  snippet: s(r.snippet),
  messageAt: s(r.message_at),
  syncedAt: s(r.synced_at),
  attachments: fromJson<MailAttachmentMeta[]>(r.attachments_json) ?? [],
});

const toRun = (r: Row): SyncRun => ({
  id: s(r.id),
  startedAt: s(r.started_at),
  finishedAt: sn(r.finished_at),
  status: s(r.status) as SyncRun['status'],
  threadsChecked: Number(r.threads_checked),
  newReplies: Number(r.new_replies),
  errorCode: sn(r.error_code),
  errorMessage: sn(r.error_message),
});

const outboundParams = (m: OutboundMessage) => ({
  id: m.id,
  company_id: m.companyId,
  draft_id: m.draftId,
  contact_id: m.contactId,
  revision_key: m.revisionKey,
  recipient_email: m.recipientEmail,
  recipient_name: m.recipientName,
  from_email: m.fromEmail,
  subject: m.subject,
  body: m.body,
  service: m.service,
  language: m.language,
  provider: m.provider,
  status: m.status,
  gmail_message_id: m.gmailMessageId,
  gmail_thread_id: m.gmailThreadId,
  rfc_message_id: m.rfcMessageId,
  error_code: m.errorCode,
  error_message: m.errorMessage,
  resolution: m.resolution,
  attempted_at: m.attemptedAt,
  sent_at: m.sentAt,
  created_at: m.createdAt,
  updated_at: m.updatedAt,
});

export function createOutreachRepository(db: Db): OutreachRepository {
  const q = {
    all: db.prepare('SELECT * FROM outbound_messages ORDER BY attempted_at DESC'),
    one: db.prepare('SELECT * FROM outbound_messages WHERE id = ?'),
    byKey: db.prepare('SELECT * FROM outbound_messages WHERE idempotency_key = ?'),
    byDraft: db.prepare('SELECT * FROM outbound_messages WHERE draft_id = ? ORDER BY attempted_at DESC'),
    insert: db.prepare(`INSERT INTO outbound_messages (id, idempotency_key, company_id, draft_id, contact_id, revision_key, recipient_email, recipient_name,
      from_email, subject, body, service, language, provider, status, gmail_message_id, gmail_thread_id, rfc_message_id, error_code, error_message,
      resolution, attempted_at, sent_at, created_at, updated_at)
      VALUES (:id, :idempotency_key, :company_id, :draft_id, :contact_id, :revision_key, :recipient_email, :recipient_name,
      :from_email, :subject, :body, :service, :language, :provider, :status, :gmail_message_id, :gmail_thread_id, :rfc_message_id, :error_code, :error_message,
      :resolution, :attempted_at, :sent_at, :created_at, :updated_at)`),
    // Only the outcome can change; the snapshot (recipient, subject, body, draft) is never updated.
    outcome: db.prepare(`UPDATE outbound_messages SET status = :status, gmail_message_id = :gmail_message_id, gmail_thread_id = :gmail_thread_id,
      rfc_message_id = :rfc_message_id, error_code = :error_code, error_message = :error_message, resolution = :resolution, sent_at = :sent_at,
      updated_at = :updated_at WHERE id = :id`),
    interrupt: db.prepare(`UPDATE outbound_messages SET status = 'ambiguous', resolution = 'interrupted', error_code = 'send_ambiguous',
      error_message = ?, updated_at = ? WHERE status = 'sending'`),
    sentWithThread: db.prepare("SELECT * FROM outbound_messages WHERE status = 'sent' AND gmail_thread_id IS NOT NULL ORDER BY sent_at"),
    sentInThread: db.prepare("SELECT * FROM outbound_messages WHERE status = 'sent' AND gmail_thread_id = ? ORDER BY sent_at"),
    threadMessages: db.prepare('SELECT * FROM mail_messages WHERE gmail_thread_id = ? ORDER BY message_at'),
    messages: db.prepare('SELECT * FROM mail_messages ORDER BY message_at'),
    hasMessage: db.prepare('SELECT 1 AS x FROM mail_messages WHERE gmail_message_id = ?'),
    inboundCount: db.prepare("SELECT COUNT(*) AS n FROM mail_messages WHERE company_id = ? AND direction = 'inbound'"),
    addMessage: db.prepare(`INSERT INTO mail_messages (id, outbound_id, company_id, gmail_thread_id, gmail_message_id, rfc_message_id, direction, from_email,
      from_name, to_json, cc_json, subject, body_text, snippet, message_at, synced_at, attachments_json)
      VALUES (:id, :outbound_id, :company_id, :gmail_thread_id, :gmail_message_id, :rfc_message_id, :direction, :from_email,
      :from_name, :to_json, :cc_json, :subject, :body_text, :snippet, :message_at, :synced_at, :attachments_json)`),
    runInsert: db.prepare(`INSERT INTO mail_sync_runs (id, started_at, finished_at, status, threads_checked, new_replies, error_code, error_message)
      VALUES (:id, :started_at, :finished_at, :status, :threads_checked, :new_replies, :error_code, :error_message)
      ON CONFLICT(id) DO UPDATE SET finished_at = excluded.finished_at, status = excluded.status, threads_checked = excluded.threads_checked,
      new_replies = excluded.new_replies, error_code = excluded.error_code, error_message = excluded.error_message`),
    lastRun: db.prepare('SELECT * FROM mail_sync_runs ORDER BY started_at DESC LIMIT 1'),
    lastOk: db.prepare("SELECT * FROM mail_sync_runs WHERE status IN ('ok','partial') ORDER BY started_at DESC LIMIT 1"),
    interruptRuns: db.prepare("UPDATE mail_sync_runs SET status = 'failed', finished_at = ?, error_code = 'sync_failed', error_message = ? WHERE status = 'running'"),
  };

  return {
    listSends: () => (q.all.all() as Row[]).map(toOutbound),
    getSend: (id) => {
      const r = q.one.get(id) as Row | undefined;
      return r ? toOutbound(r) : null;
    },
    findByIdempotencyKey: (key) => {
      const r = q.byKey.get(key) as Row | undefined;
      return r ? toOutbound(r) : null;
    },
    listSendsForDraft: (draftId) => (q.byDraft.all(draftId) as Row[]).map(toOutbound),
    insertSend: (send, idempotencyKey) => {
      q.insert.run({ ...outboundParams(send), idempotency_key: idempotencyKey });
    },
    updateOutcome: (send) => {
      const p = outboundParams(send);
      q.outcome.run({
        id: p.id,
        status: p.status,
        gmail_message_id: p.gmail_message_id,
        gmail_thread_id: p.gmail_thread_id,
        rfc_message_id: p.rfc_message_id,
        error_code: p.error_code,
        error_message: p.error_message,
        resolution: p.resolution,
        sent_at: p.sent_at,
        updated_at: p.updated_at,
      });
    },
    markInterruptedSends: (message, at) => Number(q.interrupt.run(message, at).changes),
    listThreadSends: () => (q.sentWithThread.all() as Row[]).map(toOutbound),
    listSendsInThread: (threadId) => (q.sentInThread.all(threadId) as Row[]).map(toOutbound),
    listThreadMessages: (threadId) => (q.threadMessages.all(threadId) as Row[]).map(toMessage),
    listMessages: () => (q.messages.all() as Row[]).map(toMessage),
    hasMessage: (gmailMessageId) => q.hasMessage.get(gmailMessageId) !== undefined,
    countInbound: (companyId) => Number((q.inboundCount.get(companyId) as { n: number }).n),
    insertMessage: (m) => {
      q.addMessage.run({
        id: m.id,
        outbound_id: m.outboundId,
        company_id: m.companyId,
        gmail_thread_id: m.gmailThreadId,
        gmail_message_id: m.gmailMessageId,
        rfc_message_id: m.rfcMessageId,
        direction: m.direction,
        from_email: m.fromEmail,
        from_name: m.fromName,
        to_json: toJson(m.to)!,
        cc_json: toJson(m.cc)!,
        subject: m.subject,
        body_text: m.bodyText,
        snippet: m.snippet,
        message_at: m.messageAt,
        synced_at: m.syncedAt,
        attachments_json: toJson(m.attachments)!,
      });
    },
    saveSyncRun: (run) => {
      q.runInsert.run({
        id: run.id,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        status: run.status,
        threads_checked: run.threadsChecked,
        new_replies: run.newReplies,
        error_code: run.errorCode,
        error_message: run.errorMessage,
      });
    },
    lastSyncRun: () => {
      const r = q.lastRun.get() as Row | undefined;
      return r ? toRun(r) : null;
    },
    lastSuccessfulSyncRun: () => {
      const r = q.lastOk.get() as Row | undefined;
      return r ? toRun(r) : null;
    },
    markInterruptedSyncRuns: (message, at) => Number(q.interruptRuns.run(at, message).changes),
  };
}
