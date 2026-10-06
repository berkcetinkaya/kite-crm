// Follow up planner (Phase 7): sequences, due detection and Berk's follow up actions.
//
// Safety rules enforced here (the browser only mirrors them):
//   - Nothing in this module sends mail. Sending is in the outreach service (sendFollowUp), behind
//     Berk's explicit confirmation and a live, read only Gmail thread check.
//   - Nothing here calls a model except prepare(), which runs only for Berk's explicit
//     "Takip Taslağını Hazırla" request. Due detection, page loads, startup: no network, no cost.
//   - A step's timer starts only from a confirmed event: the previous message confirmed sent by
//     Gmail, or Berk explicitly skipping the previous step. Time passing never advances a sequence.
//   - Every state change is one transaction (sequence + steps + draft + company history together).
import type { Company } from '../../src/domain/company';
import {
  addDays,
  currentStepOf,
  DAY_MS,
  DEFAULT_FOLLOW_UP_SETTINGS,
  effectiveStatus,
  FOLLOW_UP_ERROR_MESSAGES,
  followUpBlockers,
  isFinished,
  isOpenStep,
  normalizeFollowUpSettings,
  queueGroup,
  statusRule,
  type FollowUpErrorCode,
  type FollowUpOverview,
  type FollowUpPlanCandidate,
  type FollowUpSequence,
  type FollowUpSequenceView,
  type FollowUpSettings,
  type FollowUpStep,
} from '../../src/domain/followUp';
import { buildMailContext } from '../../src/domain/mail/context';
import type { MailDraft } from '../../src/domain/mail/draft';
import { buildFollowUpContext, type FollowUpPreviousMessage } from '../../src/domain/mail/followUpContext';
import type { OutboundMessage } from '../../src/domain/outreach';
import { SALES_STATUS } from '../../src/domain/salesStatus';
import { formatShortDate } from '../../src/lib/date';
import { createId } from '../../src/lib/id';
import { actionMeta } from '../../src/state/companies/companyCommands';
import { companiesReducer, type CompaniesAction } from '../../src/state/companies/companiesReducer';
import { buildMailRequest } from '../../src/state/mail/mailRequest';
import { mailReducer } from '../../src/state/mail/mailReducer';
import type { Store } from '../db/store';
import { generateFollowUpDraft } from '../mail/generate';
import type { MailProviderAdapter } from '../mail/provider';

export const FOLLOW_UP_SETTINGS_KEY = 'follow_up';
const MAX_POSTPONE_DAYS = 365;

const HTTP: Record<FollowUpErrorCode, number> = {
  followup_not_found: 404,
  followup_disabled: 409,
  followup_not_active: 409,
  followup_not_due: 409,
  followup_blocked: 409,
  followup_wrong_state: 409,
  followup_exists: 409,
  followup_not_eligible: 409,
  followup_reply_found: 409,
  followup_check_failed: 503,
  followup_thread_headers: 409,
  followup_invalid_date: 400,
  followup_subject_locked: 400,
};

export class FollowUpError extends Error {
  readonly status: number;
  constructor(
    public readonly code: FollowUpErrorCode,
    public readonly extra: Record<string, unknown> = {},
    message?: string,
  ) {
    super(message ?? FOLLOW_UP_ERROR_MESSAGES[code]);
    this.name = 'FollowUpError';
    this.status = HTTP[code];
  }
}

const day = (iso: string) => formatShortDate(new Date(iso));

export function createFollowUpPlanner(store: Store, deps: { now?: () => Date; mailProvider?: MailProviderAdapter | null } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  // ---------- helpers ----------

  function settings(): FollowUpSettings {
    return normalizeFollowUpSettings(store.settings.get<FollowUpSettings>(FOLLOW_UP_SETTINGS_KEY) ?? DEFAULT_FOLLOW_UP_SETTINGS);
  }

  function companyOf(id: string): Company {
    const c = store.companies.get(id);
    if (!c) throw new FollowUpError('followup_not_found');
    return c;
  }

  /** Applies a company action (history, last contact) to the stored company. */
  function applyCompany(id: string, make: (meta: ReturnType<typeof actionMeta>) => CompaniesAction, at: string): Company {
    const current = companyOf(id);
    const [next] = companiesReducer([current], make(actionMeta(at)));
    if (next !== current) store.companies.save(next);
    return next;
  }

  const history = (companyId: string, description: string, at: string) => applyCompany(companyId, (meta) => ({ type: 'followUpEvent', id: companyId, description, meta }), at);

  function facts(seq: FollowUpSequence) {
    return {
      company: companyOf(seq.companyId),
      sends: store.outreach.listSends().filter((s) => s.companyId === seq.companyId),
      threadMessages: store.outreach.listThreadMessages(seq.gmailThreadId),
      settings: settings(),
    };
  }

  const hasInbound = (threadId: string) => store.outreach.listThreadMessages(threadId).some((m) => m.direction === 'inbound');

  function withStep(seq: FollowUpSequence, step: FollowUpStep): FollowUpSequence {
    return { ...seq, steps: seq.steps.map((s) => (s.id === step.id ? step : s)) };
  }

  /** Ends a sequence: open steps are cancelled (drafts and sends stay for the history). */
  function finish(seq: FollowUpSequence, at: string, patch: Partial<FollowUpSequence>, cancelReason: FollowUpStep['cancelReason']): FollowUpSequence {
    return {
      ...seq,
      ...patch,
      currentStep: null,
      pauseReason: null,
      updatedAt: at,
      steps: seq.steps.map((s) => (isOpenStep(s) ? { ...s, status: 'cancelled' as const, cancelledAt: at, cancelReason, updatedAt: at } : s)),
    };
  }

  /** Loads a sequence and its step, checking the step belongs to it. */
  function loadStep(stepId: string): { seq: FollowUpSequence; step: FollowUpStep } {
    const step = store.followUps.getStep(stepId);
    const seq = step ? store.followUps.get(step.sequenceId) : null;
    if (!step || !seq) throw new FollowUpError('followup_not_found');
    return { seq, step };
  }

  /** The step must be the sequence's current one; the sequence must not have ended. */
  function requireCurrent(seq: FollowUpSequence, step: FollowUpStep) {
    if (isFinished(seq)) throw new FollowUpError('followup_not_active');
    if (currentStepOf(seq)?.id !== step.id) throw new FollowUpError('followup_wrong_state');
  }

  function requireActive(seq: FollowUpSequence) {
    if (!settings().enabled) throw new FollowUpError('followup_disabled');
    if (seq.status !== 'active') throw new FollowUpError('followup_not_active');
  }

  function requireUnblocked(seq: FollowUpSequence) {
    const blockers = followUpBlockers(seq, facts(seq));
    if (blockers.length) throw new FollowUpError('followup_blocked', {}, blockers[0]);
  }

  const isDue = (step: FollowUpStep, at: string) => !!step.dueAt && step.dueAt <= at;

  // ---------- sequence creation ----------

  /** First contact sends: drafts that are not follow ups. */
  const isFirstContactSend = (s: OutboundMessage) => store.mail.get(s.draftId)?.kind !== 'follow_up';

  /**
   * Builds a sequence for a confirmed first contact send. Step 1 is due `delays[0]` days after the
   * CONFIRMED sentAt; later steps get their due date only when the previous step is confirmed.
   */
  function newSequence(send: OutboundMessage, origin: FollowUpSequence['origin'], at: string): FollowUpSequence {
    if (send.status !== 'sent' || !send.sentAt || !send.gmailThreadId) throw new FollowUpError('followup_not_eligible');
    const s = settings();
    const id = createId('fus');
    const steps: FollowUpStep[] = Array.from({ length: s.maxSteps }, (_, i) => ({
      id: createId('fst'),
      sequenceId: id,
      stepNumber: i + 1,
      delayDays: s.delays[i],
      dueAt: i === 0 ? addDays(send.sentAt!, s.delays[0]) : null,
      originalDueAt: null,
      status: i === 0 ? 'scheduled' : 'pending',
      draftId: null,
      outboundMessageId: null,
      createdAt: at,
      updatedAt: at,
      preparedAt: null,
      approvedAt: null,
      sentAt: null,
      skippedAt: null,
      postponedAt: null,
      cancelledAt: null,
      cancelReason: null,
    }));
    return {
      id,
      companyId: send.companyId,
      initialOutboundMessageId: send.id,
      originalDraftId: send.draftId,
      contactId: send.contactId,
      recipientEmailSnapshot: send.recipientEmail,
      recipientNameSnapshot: send.recipientName,
      subject: send.subject,
      service: send.service,
      language: send.language,
      gmailThreadId: send.gmailThreadId,
      status: 'active',
      currentStep: 1,
      maxSteps: s.maxSteps,
      origin,
      pauseReason: null,
      createdAt: at,
      updatedAt: at,
      completedAt: null,
      stoppedAt: null,
      stopReason: null,
      stoppedBy: null,
      steps,
    };
  }

  function insertSequence(seq: FollowUpSequence, at: string): FollowUpSequence {
    store.followUps.save(seq);
    history(seq.companyId, `Takip planı oluşturuldu: ${seq.maxSteps} takip, 1. takip ${day(seq.steps[0].dueAt!)}`, at);
    return seq;
  }

  /** Why a confirmed first contact send cannot get a plan, or null when it can. */
  function planBlocker(send: OutboundMessage): FollowUpErrorCode | null {
    if (send.status !== 'sent' || !send.gmailThreadId || !isFirstContactSend(send)) return 'followup_not_eligible';
    if (store.followUps.getByInitialOutbound(send.id)) return 'followup_exists';
    if (hasInbound(send.gmailThreadId)) return 'followup_not_eligible';
    const company = store.companies.get(send.companyId);
    if (!company || statusRule(company.status) !== 'continue') return 'followup_not_eligible';
    return null;
  }

  // ---------- views ----------

  function view(seq: FollowUpSequence, at: string): FollowUpSequenceView {
    const f = facts(seq);
    const blockers = isFinished(seq) ? [] : followUpBlockers(seq, f);
    const step = currentStepOf(seq);
    const sent = f.sends.filter((s) => s.status === 'sent' && s.gmailThreadId === seq.gmailThreadId && s.sentAt).map((s) => s.sentAt!);
    return {
      ...seq,
      effectiveStatus: effectiveStatus(seq, blockers),
      blockers,
      queueGroup: queueGroup(seq, blockers, at),
      isDue: !!step && isDue(step, at),
      lastSentAt: sent.sort().at(-1) ?? null,
      replied: f.threadMessages.some((m) => m.direction === 'inbound'),
    };
  }

  function candidates(): FollowUpPlanCandidate[] {
    return store.outreach
      .listSends()
      .filter((s) => planBlocker(s) === null)
      .map((s) => ({ companyId: s.companyId, outboundMessageId: s.id, sentAt: s.sentAt! }));
  }

  // ---------- rules applied to stored state ----------

  /** A genuine reply was stored in this thread: every open sequence of it ends (same transaction). */
  function onReplyStored(threadId: string, at: string): FollowUpSequence[] {
    const changed: FollowUpSequence[] = [];
    for (const seq of store.followUps.listByThread(threadId)) {
      if (isFinished(seq)) continue;
      const next = finish(seq, at, { status: 'completed_replied', completedAt: at }, 'reply');
      store.followUps.save(next);
      history(seq.companyId, 'Yanıt geldiği için kalan takipler durduruldu', at);
      changed.push(next);
    }
    return changed;
  }

  /** Applies the sales status rules to the company's open sequences. Never changes the status. */
  function onCompanyStatus(company: Company, at: string): FollowUpSequence[] {
    const changed: FollowUpSequence[] = [];
    for (const seq of store.followUps.listByCompany(company.id)) {
      if (isFinished(seq)) continue;
      const rule = statusRule(company.status);
      let next: FollowUpSequence | null = null;
      let note = '';
      if (rule === 'pause' && seq.status === 'active') {
        next = { ...seq, status: 'paused', pauseReason: 'status_later', updatedAt: at };
        note = 'Takip duraklatıldı: şirket Şimdilik Bekle durumunda';
      } else if (rule === 'reply') {
        next = hasInbound(seq.gmailThreadId)
          ? finish(seq, at, { status: 'completed_replied', completedAt: at }, 'reply')
          : finish(seq, at, { status: 'stopped', stoppedAt: at, stoppedBy: 'system', stopReason: `Satış durumu: ${SALES_STATUS[company.status].label}` }, 'status');
        note = `Takip durduruldu: satış durumu ${SALES_STATUS[company.status].label}`;
      } else if (rule === 'stop') {
        next = finish(seq, at, { status: 'stopped', stoppedAt: at, stoppedBy: 'system', stopReason: `Satış durumu: ${SALES_STATUS[company.status].label}` }, 'status');
        note = `Takip durduruldu: satış durumu ${SALES_STATUS[company.status].label}`;
      }
      if (next) {
        store.followUps.save(next);
        history(company.id, note, at);
        changed.push(next);
      }
    }
    return changed;
  }

  /**
   * Safety net run on server start and whenever follow ups are listed: applies the rules to stored
   * state (replies, sales status, disabled setting). Local data only; no network, no model.
   */
  function reconcileAll(): number {
    return store.transaction(() => {
      const at = now();
      const enabled = settings().enabled;
      let changes = 0;
      for (const seq of store.followUps.list()) {
        if (isFinished(seq)) continue;
        if (hasInbound(seq.gmailThreadId)) {
          changes += onReplyStored(seq.gmailThreadId, at).length;
          continue;
        }
        const company = store.companies.get(seq.companyId);
        if (company) changes += onCompanyStatus(company, at).length;
        const fresh = store.followUps.get(seq.id)!;
        if (!enabled && fresh.status === 'active') {
          store.followUps.save({ ...fresh, status: 'paused', pauseReason: 'settings_disabled', updatedAt: at });
          changes += 1;
        }
      }
      return changes;
    });
  }

  // ---------- generation context ----------

  function previousMessages(seq: FollowUpSequence): FollowUpPreviousMessage[] {
    const sends = store.outreach.listSendsInThread(seq.gmailThreadId);
    return sends.map((s) => {
      const d = store.mail.get(s.draftId);
      const stepNumber = d?.followUp?.stepNumber ?? 0;
      return {
        ref: stepNumber === 0 ? 'original' : `followup_${stepNumber}`,
        stepNumber,
        // The immutable outbound snapshot: exactly what the prospect received.
        body: s.body,
        sentAt: s.sentAt!,
        angle: d?.generationNotes.followUp?.angle ?? null,
        companyObservation: d?.generationNotes.companyObservation ?? null,
        evidenceRefsUsed: d?.evidenceRefs.map((e) => e.id) ?? [],
        sectorBenefitsUsed: d?.sectorContext.useCasesUsed.map((u) => u.id) ?? [],
      };
    });
  }

  function contextFor(seq: FollowUpSequence, stepNumber: number) {
    const company = companyOf(seq.companyId);
    const research = company.researchRef?.mode === 'real' ? store.research.findTransferredResult(company.id) : null;
    const base = buildMailContext(buildMailRequest(company, research, { service: seq.service, language: seq.language, contactId: seq.contactId }));
    return {
      ctx: buildFollowUpContext({ base, stepNumber, maxSteps: seq.maxSteps, subject: seq.subject, previousMessages: previousMessages(seq), now: now() }),
      researchJobId: research?.researchRequestId ?? null,
    };
  }

  /** Checks shared by prepare (before and after generation) and send. */
  function requirePreparable(seq: FollowUpSequence, step: FollowUpStep, at: string) {
    requireCurrent(seq, step);
    requireActive(seq);
    if (!isDue(step, at)) throw new FollowUpError('followup_not_due');
    requireUnblocked(seq);
  }

  return {
    settings,

    /** Saves settings. Turning follow ups off pauses every active sequence (Berk resumes each one). */
    saveSettings(input: FollowUpSettings): FollowUpSettings {
      return store.transaction(() => {
        const at = now();
        const prev = settings();
        const next = normalizeFollowUpSettings(input);
        store.settings.set(FOLLOW_UP_SETTINGS_KEY, next, at);
        if (prev.enabled && !next.enabled) {
          for (const seq of store.followUps.list()) {
            if (seq.status !== 'active') continue;
            store.followUps.save({ ...seq, status: 'paused', pauseReason: 'settings_disabled', updatedAt: at });
            history(seq.companyId, 'Takip duraklatıldı: takip sistemi kapatıldı', at);
          }
        }
        return next;
      });
    },

    /** Everything Mail & Takip needs. Applies the stored-state rules first (no network). */
    overview(): FollowUpOverview {
      reconcileAll();
      const at = now();
      return { now: at, settings: settings(), sequences: store.followUps.list().map((s) => view(s, at)), candidates: candidates() };
    },

    /** Read-only sequence views for the dashboard: no reconcile, no writes. */
    readViews: (): FollowUpSequenceView[] => {
      const at = now();
      return store.followUps.list().map((s) => view(s, at));
    },

    view: (id: string) => {
      const seq = store.followUps.get(id);
      if (!seq) throw new FollowUpError('followup_not_found');
      return view(seq, now());
    },

    drafts: () => store.mail.listFollowUps(),
    reconcileAll,
    onReplyStored,
    onCompanyStatus,

    /**
     * Automatic plan right after a confirmed first contact send (called inside the send's
     * transaction, in a savepoint). Returns null when follow ups are off or the send is not eligible.
     */
    createAutomatic(send: OutboundMessage, at: string): FollowUpSequence | null {
      if (!settings().enabled || planBlocker(send) !== null) return null;
      return insertSequence(newSequence(send, 'automatic', at), at);
    },

    /** "Takip Planı Oluştur" for a first contact sent before Phase 7 (or while follow ups were off). */
    createPlan(companyId: string): FollowUpSequenceView {
      return store.transaction(() => {
        if (!settings().enabled) throw new FollowUpError('followup_disabled');
        const at = now();
        const sends = store.outreach.listSends().filter((s) => s.companyId === companyId && s.status === 'sent' && isFirstContactSend(s));
        if (sends.length === 0) throw new FollowUpError('followup_not_eligible');
        const send = sends.find((s) => planBlocker(s) === null);
        if (!send) throw new FollowUpError(sends.some((s) => store.followUps.getByInitialOutbound(s.id)) ? 'followup_exists' : 'followup_not_eligible');
        if (store.outreach.listSends().some((s) => s.companyId === companyId && (s.status === 'ambiguous' || s.status === 'sending'))) throw new FollowUpError('followup_blocked', {}, 'Önceki bir gönderimin sonucu belirsiz. Önce onu çöz.');
        const seq = insertSequence(newSequence(send, 'manual', at), at);
        return view(seq, at);
      });
    },

    /**
     * "Takip Taslağını Hazırla" (or "Yeniden Oluştur"): the ONLY place a follow up is generated.
     * Generation runs before the write; the state is checked again afterwards, so a reply or stop
     * that happened meanwhile wins and nothing is saved.
     */
    async prepare(stepId: string, signal?: AbortSignal): Promise<{ sequence: FollowUpSequenceView; draft: MailDraft }> {
      const provider = deps.mailProvider;
      if (!provider) throw new FollowUpError('followup_blocked', {}, 'Takip taslağı üretmek için taslak servisi yapılandırılmalı.');
      const { seq, step } = loadStep(stepId);
      requirePreparable(seq, step, now());
      if (step.status === 'approved') throw new FollowUpError('followup_wrong_state', {}, 'Onaylanmış bir takip yeniden oluşturulmadan önce düzenlenip kaydedilmeli.');
      const { ctx, researchJobId } = contextFor(seq, step.stepNumber);
      const generated = await generateFollowUpDraft(provider, ctx, { signal });
      return store.transaction(() => {
        const at = now();
        const again = loadStep(stepId);
        requirePreparable(again.seq, again.step, at);
        if (again.step.status === 'approved') throw new FollowUpError('followup_wrong_state');
        const existing = store.mail.getByStep(seq.id, step.stepNumber);
        const previousVersions =
          existing && (existing.editedSinceGeneration || existing.status !== 'review')
            ? [{ subject: existing.selectedSubject, body: existing.body, savedAt: at, reason: 'before_regeneration' as const }, ...existing.previousVersions].slice(0, 10)
            : (existing?.previousVersions ?? []);
        const follows = store.outreach.listSendsInThread(seq.gmailThreadId).at(-1)!;
        const draft: MailDraft = {
          id: existing?.id ?? createId('mail'),
          kind: 'follow_up',
          followUp: { sequenceId: seq.id, stepNumber: step.stepNumber, followsOutboundId: follows.id },
          companyId: seq.companyId,
          contactId: seq.contactId,
          service: seq.service,
          language: seq.language,
          subjectOptions: [seq.subject],
          selectedSubject: seq.subject,
          body: generated.body,
          status: 'review',
          createdAt: existing?.createdAt ?? at,
          updatedAt: at,
          generatedAt: at,
          approvedAt: null,
          researchJobId,
          evidenceRefs: generated.evidenceRefs,
          sectorContext: generated.sectorContext,
          generationNotes: generated.generationNotes,
          editedSinceGeneration: false,
          previousVersions,
        };
        store.mail.save(draft);
        const nextStep: FollowUpStep = { ...again.step, status: 'prepared', draftId: draft.id, preparedAt: at, approvedAt: null, updatedAt: at };
        const next = withStep({ ...again.seq, updatedAt: at }, nextStep);
        store.followUps.save(next);
        return { sequence: view(next, at), draft };
      });
    },

    /** Kaydet: body edits only (the subject is the conversation's). An approved draft returns to Taslak. */
    saveDraft(stepId: string, body: string): { sequence: FollowUpSequenceView; draft: MailDraft } {
      return store.transaction(() => {
        const at = now();
        const { seq, step } = loadStep(stepId);
        requireCurrent(seq, step);
        if (step.status !== 'prepared' && step.status !== 'approved') throw new FollowUpError('followup_wrong_state');
        const current = store.mail.get(step.draftId!)!;
        const [draft] = mailReducer({ drafts: [current] }, { type: 'save', id: current.id, edits: { selectedSubject: seq.subject, body }, at }).drafts;
        store.mail.save(draft);
        const nextStep: FollowUpStep = draft.status === 'approved' ? step : { ...step, status: 'prepared', approvedAt: null, updatedAt: at };
        const next = withStep({ ...seq, updatedAt: at }, nextStep);
        store.followUps.save(next);
        return { sequence: view(next, at), draft };
      });
    },

    /** Onayla: approves the (edited) body. Approval never sends and never overrides a reply. */
    approveDraft(stepId: string, body: string): { sequence: FollowUpSequenceView; draft: MailDraft } {
      return store.transaction(() => {
        const at = now();
        const { seq, step } = loadStep(stepId);
        requireCurrent(seq, step);
        if (seq.status !== 'active') throw new FollowUpError('followup_not_active');
        if (step.status !== 'prepared' && step.status !== 'approved') throw new FollowUpError('followup_wrong_state');
        requireUnblocked(seq);
        const current = store.mail.get(step.draftId!)!;
        const [draft] = mailReducer({ drafts: [current] }, { type: 'approve', id: current.id, edits: { selectedSubject: seq.subject, body }, at }).drafts;
        store.mail.save(draft);
        const next = withStep({ ...seq, updatedAt: at }, { ...step, status: 'approved', approvedAt: at, updatedAt: at });
        store.followUps.save(next);
        return { sequence: view(next, at), draft };
      });
    },

    /** Ertele: a new, later due date for the current step. The sequence configuration is unchanged. */
    postpone(stepId: string, dueAt: string): FollowUpSequenceView {
      return store.transaction(() => {
        const at = now();
        const { seq, step } = loadStep(stepId);
        requireCurrent(seq, step);
        const t = new Date(dueAt).getTime();
        if (!Number.isFinite(t) || t <= new Date(at).getTime() || t > new Date(at).getTime() + MAX_POSTPONE_DAYS * DAY_MS) throw new FollowUpError('followup_invalid_date');
        const iso = new Date(t).toISOString();
        const next = withStep({ ...seq, updatedAt: at }, { ...step, dueAt: iso, originalDueAt: step.originalDueAt ?? step.dueAt, postponedAt: at, updatedAt: at });
        store.followUps.save(next);
        history(seq.companyId, `${step.stepNumber}. takip ertelendi: ${day(iso)}`, at);
        return view(next, at);
      });
    },

    /**
     * Adımı Atla: nothing is sent. The next step's timer starts from the skip time (no email is
     * pretended to have been sent); skipping the last step completes the sequence.
     */
    skip(stepId: string): FollowUpSequenceView {
      return store.transaction(() => {
        const at = now();
        const { seq, step } = loadStep(stepId);
        requireCurrent(seq, step);
        if (seq.status !== 'active') throw new FollowUpError('followup_not_active');
        if (store.outreach.listSendsForDraft(step.draftId ?? '').some((s) => s.status === 'sending' || s.status === 'ambiguous')) throw new FollowUpError('followup_blocked', {}, 'Bu adımın gönderimi sürüyor veya sonucu belirsiz; atlanamaz.');
        let next = withStep(seq, { ...step, status: 'skipped', skippedAt: at, updatedAt: at });
        const following = seq.steps.find((s) => s.stepNumber === step.stepNumber + 1);
        if (following) {
          next = withStep({ ...next, currentStep: following.stepNumber, updatedAt: at }, { ...following, status: 'scheduled', dueAt: addDays(at, following.delayDays), updatedAt: at });
        } else {
          next = { ...next, status: 'completed_no_reply', completedAt: at, currentStep: null, updatedAt: at };
        }
        store.followUps.save(next);
        history(seq.companyId, `${step.stepNumber}. takip atlandı${following ? `; ${following.stepNumber}. takip ${day(addDays(at, following.delayDays))}` : '; takip planı tamamlandı'}`, at);
        return view(next, at);
      });
    },

    /** Takibi Durdur: remaining steps are cancelled; drafts and sends stay. Sales status unchanged. */
    stop(sequenceId: string, reason: string | null): FollowUpSequenceView {
      return store.transaction(() => {
        const at = now();
        const seq = store.followUps.get(sequenceId);
        if (!seq) throw new FollowUpError('followup_not_found');
        if (isFinished(seq)) throw new FollowUpError('followup_not_active');
        const text = reason?.trim() ? reason.trim().slice(0, 300) : null;
        const next = finish(seq, at, { status: 'stopped', stoppedAt: at, stoppedBy: 'berk', stopReason: text }, 'stopped');
        store.followUps.save(next);
        history(seq.companyId, `Takip durduruldu${text ? `: ${text}` : ''}`, at);
        return view(next, at);
      });
    },

    /** Takibi Sürdür: a paused sequence continues (only when follow ups are on and the status allows). */
    resume(sequenceId: string): FollowUpSequenceView {
      return store.transaction(() => {
        const at = now();
        const seq = store.followUps.get(sequenceId);
        if (!seq) throw new FollowUpError('followup_not_found');
        if (seq.status !== 'paused') throw new FollowUpError('followup_wrong_state');
        if (!settings().enabled) throw new FollowUpError('followup_disabled');
        if (statusRule(companyOf(seq.companyId).status) !== 'continue') throw new FollowUpError('followup_blocked', {}, 'Şirketin satış durumu takip için uygun değil. Önce durumu İlk Temas olarak güncelle.');
        const next: FollowUpSequence = { ...seq, status: 'active', pauseReason: null, updatedAt: at };
        store.followUps.save(next);
        history(seq.companyId, 'Takip sürdürüldü', at);
        return view(next, at);
      });
    },

    /**
     * For sendFollowUp (inside its transaction): the approved, due, unblocked step and its draft.
     * Throws when anything is not right; the outreach service never sends without this.
     */
    sendTarget(stepId: string): { seq: FollowUpSequence; step: FollowUpStep; draft: MailDraft } {
      const { seq, step } = loadStep(stepId);
      requireCurrent(seq, step);
      requireActive(seq);
      if (step.status !== 'approved' || !step.draftId) throw new FollowUpError('followup_wrong_state', {}, 'Yalnızca onaylanmış takip taslakları gönderilebilir.');
      if (!isDue(step, now())) throw new FollowUpError('followup_not_due');
      const draft = store.mail.get(step.draftId);
      if (!draft || draft.status !== 'approved' || !draft.approvedAt || draft.kind !== 'follow_up') throw new FollowUpError('followup_wrong_state', {}, 'Yalnızca onaylanmış takip taslakları gönderilebilir.');
      requireUnblocked(seq);
      return { seq, step, draft };
    },

    /**
     * Inside the confirmed send's transaction: the step becomes "sent" and the next step's timer
     * starts from the CONFIRMED sentAt; after the last step the sequence is completed.
     */
    recordSent(draft: MailDraft, send: OutboundMessage, at: string): FollowUpSequence | null {
      const link = draft.followUp;
      if (!link) return null;
      const seq = store.followUps.get(link.sequenceId);
      const step = seq?.steps.find((s) => s.stepNumber === link.stepNumber);
      if (!seq || !step) return null;
      const sentAt = send.sentAt ?? at;
      let next = withStep(seq, { ...step, status: 'sent', sentAt, outboundMessageId: send.id, updatedAt: at });
      const following = seq.steps.find((s) => s.stepNumber === step.stepNumber + 1);
      if (isFinished(seq)) {
        // Ended meanwhile (e.g. a reconcile of an old unclear send): record the send, schedule nothing.
      } else if (following && following.status === 'pending') {
        next = withStep({ ...next, currentStep: following.stepNumber, updatedAt: at }, { ...following, status: 'scheduled', dueAt: addDays(sentAt, following.delayDays), updatedAt: at });
      } else {
        next = { ...next, status: 'completed_no_reply', completedAt: at, currentStep: null, updatedAt: at };
      }
      store.followUps.save(next);
      return next;
    },
  };
}

export type FollowUpPlanner = ReturnType<typeof createFollowUpPlanner>;
