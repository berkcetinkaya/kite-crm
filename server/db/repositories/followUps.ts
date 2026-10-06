// SQLite follow up repository (Phase 7): sequences, their steps and the operational settings table.
// Steps are rows (one per step number, UNIQUE per sequence) so a step can never exist twice, and a
// partial unique index allows at most one current step (scheduled / prepared / approved) per sequence.
import type { FollowUpSequence, FollowUpStep } from '../../../src/domain/followUp';
import { fromJson, transaction, type Db } from '../sqlite';
import type { FollowUpRepository, SettingsRepository } from './types';

type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const toStep = (r: Row): FollowUpStep => ({
  id: s(r.id),
  sequenceId: s(r.sequence_id),
  stepNumber: Number(r.step_number),
  delayDays: Number(r.delay_days),
  dueAt: sn(r.due_at),
  originalDueAt: sn(r.original_due_at),
  status: s(r.status) as FollowUpStep['status'],
  draftId: sn(r.draft_id),
  outboundMessageId: sn(r.outbound_message_id),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
  preparedAt: sn(r.prepared_at),
  approvedAt: sn(r.approved_at),
  sentAt: sn(r.sent_at),
  skippedAt: sn(r.skipped_at),
  postponedAt: sn(r.postponed_at),
  cancelledAt: sn(r.cancelled_at),
  cancelReason: sn(r.cancel_reason) as FollowUpStep['cancelReason'],
});

const toSequence = (r: Row, steps: FollowUpStep[]): FollowUpSequence => ({
  id: s(r.id),
  companyId: s(r.company_id),
  initialOutboundMessageId: s(r.initial_outbound_id),
  originalDraftId: s(r.original_draft_id),
  contactId: sn(r.contact_id),
  recipientEmailSnapshot: s(r.recipient_email),
  recipientNameSnapshot: sn(r.recipient_name),
  subject: s(r.subject),
  service: s(r.service) as FollowUpSequence['service'],
  language: s(r.language) as FollowUpSequence['language'],
  gmailThreadId: s(r.gmail_thread_id),
  status: s(r.status) as FollowUpSequence['status'],
  currentStep: nn(r.current_step),
  maxSteps: Number(r.max_steps),
  origin: s(r.origin) as FollowUpSequence['origin'],
  pauseReason: sn(r.pause_reason) as FollowUpSequence['pauseReason'],
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
  completedAt: sn(r.completed_at),
  stoppedAt: sn(r.stopped_at),
  stopReason: sn(r.stop_reason),
  stoppedBy: sn(r.stopped_by) as FollowUpSequence['stoppedBy'],
  steps,
});

const stepParams = (st: FollowUpStep) => ({
  id: st.id,
  sequence_id: st.sequenceId,
  step_number: st.stepNumber,
  delay_days: st.delayDays,
  due_at: st.dueAt,
  original_due_at: st.originalDueAt,
  status: st.status,
  draft_id: st.draftId,
  outbound_message_id: st.outboundMessageId,
  created_at: st.createdAt,
  updated_at: st.updatedAt,
  prepared_at: st.preparedAt,
  approved_at: st.approvedAt,
  sent_at: st.sentAt,
  skipped_at: st.skippedAt,
  postponed_at: st.postponedAt,
  cancelled_at: st.cancelledAt,
  cancel_reason: st.cancelReason,
});

export function createFollowUpRepository(db: Db): FollowUpRepository {
  const q = {
    all: db.prepare('SELECT * FROM follow_up_sequences ORDER BY created_at DESC'),
    one: db.prepare('SELECT * FROM follow_up_sequences WHERE id = ?'),
    byOutbound: db.prepare('SELECT * FROM follow_up_sequences WHERE initial_outbound_id = ?'),
    byThread: db.prepare('SELECT * FROM follow_up_sequences WHERE gmail_thread_id = ?'),
    byCompany: db.prepare('SELECT * FROM follow_up_sequences WHERE company_id = ? ORDER BY created_at DESC'),
    steps: db.prepare('SELECT * FROM follow_up_steps ORDER BY sequence_id, step_number'),
    stepsOf: db.prepare('SELECT * FROM follow_up_steps WHERE sequence_id = ? ORDER BY step_number'),
    step: db.prepare('SELECT * FROM follow_up_steps WHERE id = ?'),
    upsertSequence: db.prepare(`INSERT INTO follow_up_sequences (id, company_id, initial_outbound_id, original_draft_id, contact_id, recipient_email, recipient_name,
      subject, service, language, gmail_thread_id, status, current_step, max_steps, origin, pause_reason, created_at, updated_at, completed_at, stopped_at,
      stop_reason, stopped_by)
      VALUES (:id, :company_id, :initial_outbound_id, :original_draft_id, :contact_id, :recipient_email, :recipient_name,
      :subject, :service, :language, :gmail_thread_id, :status, :current_step, :max_steps, :origin, :pause_reason, :created_at, :updated_at, :completed_at, :stopped_at,
      :stop_reason, :stopped_by)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, current_step = excluded.current_step, pause_reason = excluded.pause_reason,
      updated_at = excluded.updated_at, completed_at = excluded.completed_at, stopped_at = excluded.stopped_at, stop_reason = excluded.stop_reason,
      stopped_by = excluded.stopped_by`),
    // Steps are written in step order: a step leaving "current" is written before the next one
    // enters it, so the one-current-step index holds at every statement.
    upsertStep: db.prepare(`INSERT INTO follow_up_steps (id, sequence_id, step_number, delay_days, due_at, original_due_at, status, draft_id, outbound_message_id,
      created_at, updated_at, prepared_at, approved_at, sent_at, skipped_at, postponed_at, cancelled_at, cancel_reason)
      VALUES (:id, :sequence_id, :step_number, :delay_days, :due_at, :original_due_at, :status, :draft_id, :outbound_message_id,
      :created_at, :updated_at, :prepared_at, :approved_at, :sent_at, :skipped_at, :postponed_at, :cancelled_at, :cancel_reason)
      ON CONFLICT(id) DO UPDATE SET due_at = excluded.due_at, original_due_at = excluded.original_due_at, status = excluded.status,
      draft_id = excluded.draft_id, outbound_message_id = excluded.outbound_message_id, updated_at = excluded.updated_at,
      prepared_at = excluded.prepared_at, approved_at = excluded.approved_at, sent_at = excluded.sent_at, skipped_at = excluded.skipped_at,
      postponed_at = excluded.postponed_at, cancelled_at = excluded.cancelled_at, cancel_reason = excluded.cancel_reason`),
  };

  const load = (r: Row | undefined) => (r ? toSequence(r, (q.stepsOf.all(s(r.id)) as Row[]).map(toStep)) : null);

  return {
    list() {
      const steps = new Map<string, FollowUpStep[]>();
      for (const r of q.steps.all() as Row[]) (steps.get(s(r.sequence_id)) ?? steps.set(s(r.sequence_id), []).get(s(r.sequence_id))!).push(toStep(r));
      return (q.all.all() as Row[]).map((r) => toSequence(r, steps.get(s(r.id)) ?? []));
    },
    get: (id) => load(q.one.get(id) as Row | undefined),
    getByInitialOutbound: (outboundId) => load(q.byOutbound.get(outboundId) as Row | undefined),
    listByThread: (threadId) => (q.byThread.all(threadId) as Row[]).map((r) => load(r)!),
    listByCompany: (companyId) => (q.byCompany.all(companyId) as Row[]).map((r) => load(r)!),
    getStep(id) {
      const r = q.step.get(id) as Row | undefined;
      return r ? toStep(r) : null;
    },
    save(seq) {
      transaction(db, () => {
        q.upsertSequence.run({
          id: seq.id,
          company_id: seq.companyId,
          initial_outbound_id: seq.initialOutboundMessageId,
          original_draft_id: seq.originalDraftId,
          contact_id: seq.contactId,
          recipient_email: seq.recipientEmailSnapshot,
          recipient_name: seq.recipientNameSnapshot,
          subject: seq.subject,
          service: seq.service,
          language: seq.language,
          gmail_thread_id: seq.gmailThreadId,
          status: seq.status,
          current_step: seq.currentStep,
          max_steps: seq.maxSteps,
          origin: seq.origin,
          pause_reason: seq.pauseReason,
          created_at: seq.createdAt,
          updated_at: seq.updatedAt,
          completed_at: seq.completedAt,
          stopped_at: seq.stoppedAt,
          stop_reason: seq.stopReason,
          stopped_by: seq.stoppedBy,
        });
        // Steps leaving the current state first, then the rest in step order.
        const current = (st: FollowUpStep) => st.status === 'scheduled' || st.status === 'prepared' || st.status === 'approved';
        const ordered = [...seq.steps].sort((a, b) => Number(current(a)) - Number(current(b)) || a.stepNumber - b.stepNumber);
        for (const st of ordered) q.upsertStep.run(stepParams(st));
      });
    },
  };
}

export function createSettingsRepository(db: Db): SettingsRepository {
  const get = db.prepare('SELECT value_json FROM app_settings WHERE key = ?');
  const put = db.prepare(`INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`);
  return {
    get<T>(key: string): T | null {
      const r = get.get(key) as Row | undefined;
      return r ? (fromJson<T>(r.value_json) ?? null) : null;
    },
    set(key, value, at) {
      put.run(key, JSON.stringify(value), at);
    },
  };
}
