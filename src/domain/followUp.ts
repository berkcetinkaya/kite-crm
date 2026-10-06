// Follow ups (Phase 7): planning, due detection and the rules that decide whether a follow up may be
// prepared or sent. Shared by the server (authority) and the browser (labels, explanations).
//
// Nothing here sends mail or calls a model. A due follow up only means "ready for Berk's attention":
// Berk explicitly prepares the draft, approves it and confirms the send, one step at a time.
//
// Timing rule: a step's timer starts only from a CONFIRMED event of the previous step (the first
// contact or previous follow up confirmed sent by Gmail, or Berk explicitly skipping it). Time
// passing alone never advances a sequence.
import type { Company } from './company';
import { isValidEmail } from '../lib/email';
import type { MailLanguage } from './mail/draft';
import type { OutboundMessage, ThreadMessage } from './outreach';
import type { SalesStatus } from './salesStatus';
import type { ServiceKey } from './services';

// ---------- Settings ----------

export const MAX_FOLLOW_UP_STEPS = 3;
export const MIN_DELAY_DAYS = 1;
export const MAX_DELAY_DAYS = 60;

export interface FollowUpSettings {
  /** Takip Sistemi Aktif: successful first contacts automatically get a sequence. */
  enabled: boolean;
  /** 1 to 3 follow ups per sequence. */
  maxSteps: number;
  /** Days after the previous confirmed message, per step (always three values; extra ones unused). */
  delays: [number, number, number];
}

export const DEFAULT_FOLLOW_UP_SETTINGS: FollowUpSettings = { enabled: true, maxSteps: 3, delays: [3, 7, 14] };

/** Normalizes stored or submitted settings; out of range values fall back to the defaults. */
export function normalizeFollowUpSettings(v: Partial<FollowUpSettings> | null | undefined): FollowUpSettings {
  const d = DEFAULT_FOLLOW_UP_SETTINGS;
  const okDelay = (n: unknown, fallback: number) => (Number.isInteger(n) && (n as number) >= MIN_DELAY_DAYS && (n as number) <= MAX_DELAY_DAYS ? (n as number) : fallback);
  const delays = Array.isArray(v?.delays) ? v.delays : [];
  return {
    enabled: typeof v?.enabled === 'boolean' ? v.enabled : d.enabled,
    maxSteps: Number.isInteger(v?.maxSteps) && v!.maxSteps! >= 1 && v!.maxSteps! <= MAX_FOLLOW_UP_STEPS ? v!.maxSteps! : d.maxSteps,
    delays: [okDelay(delays[0], d.delays[0]), okDelay(delays[1], d.delays[1]), okDelay(delays[2], d.delays[2])],
  };
}

// ---------- Sequence and step model ----------

/**
 * active             → waiting for the next step (Takip aktif)
 * paused             → Takip ayarı kapatıldı or company is "Şimdilik Bekle"; Berk resumes explicitly
 * completed_replied  → a genuine reply arrived; remaining steps cancelled
 * completed_no_reply → every step was sent or skipped without a reply
 * stopped            → Berk stopped it (Takibi Durdur) or the company left the follow up stages
 *
 * "blocked" is not stored: it is derived (ambiguous send, recipient removed, …) so it clears itself
 * as soon as the cause is resolved, e.g. when Berk settles an unclear send.
 */
export const FOLLOW_UP_SEQUENCE_STATUSES = ['active', 'paused', 'completed_replied', 'completed_no_reply', 'stopped'] as const;
export type FollowUpSequenceStatus = (typeof FOLLOW_UP_SEQUENCE_STATUSES)[number];
export type FollowUpEffectiveStatus = FollowUpSequenceStatus | 'blocked';

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpEffectiveStatus, string> = {
  active: 'Takip aktif',
  paused: 'Duraklatıldı',
  completed_replied: 'Yanıt geldi, takip bitti',
  completed_no_reply: 'Takip tamamlandı',
  stopped: 'Durduruldu',
  blocked: 'Engellendi',
};

/**
 * pending   → previous step not confirmed yet; no due date
 * scheduled → due date set (from the previous confirmed event); no draft yet
 * prepared  → Berk prepared the draft (İncelenecek or Taslak)
 * approved  → Berk approved the draft; sending still needs the explicit confirmation
 * sent      → Gmail confirmed the follow up
 * skipped   → Berk skipped the step (Adımı Atla); nothing was sent
 * cancelled → a reply arrived, Berk stopped the sequence, or the company left the follow up stages
 */
export const FOLLOW_UP_STEP_STATUSES = ['pending', 'scheduled', 'prepared', 'approved', 'sent', 'skipped', 'cancelled'] as const;
export type FollowUpStepStatus = (typeof FOLLOW_UP_STEP_STATUSES)[number];

export const FOLLOW_UP_STEP_STATUS_LABELS: Record<FollowUpStepStatus, string> = {
  pending: 'Bekliyor',
  scheduled: 'Planlandı',
  prepared: 'Taslak hazır',
  approved: 'Onaylandı',
  sent: 'Gönderildi',
  skipped: 'Atlandı',
  cancelled: 'İptal edildi',
};

export const FOLLOW_UP_CANCEL_REASONS = ['reply', 'stopped', 'status'] as const;
export type FollowUpCancelReason = (typeof FOLLOW_UP_CANCEL_REASONS)[number];

export const FOLLOW_UP_PAUSE_REASONS = ['settings_disabled', 'status_later'] as const;
export type FollowUpPauseReason = (typeof FOLLOW_UP_PAUSE_REASONS)[number];

export const FOLLOW_UP_PAUSE_LABELS: Record<FollowUpPauseReason, string> = {
  settings_disabled: 'Takip sistemi kapatıldığı için duraklatıldı.',
  status_later: 'Şirket “Şimdilik Bekle” durumuna alındığı için duraklatıldı.',
};

export interface FollowUpStep {
  id: string;
  sequenceId: string;
  stepNumber: number;
  delayDays: number;
  /** UTC. Null while the previous step is not confirmed. */
  dueAt: string | null;
  /** Due date before the first manual postponement (Ertele). */
  originalDueAt: string | null;
  status: FollowUpStepStatus;
  draftId: string | null;
  outboundMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  preparedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  skippedAt: string | null;
  postponedAt: string | null;
  cancelledAt: string | null;
  cancelReason: FollowUpCancelReason | null;
}

export interface FollowUpSequence {
  id: string;
  companyId: string;
  /** The confirmed first contact send this sequence follows. */
  initialOutboundMessageId: string;
  originalDraftId: string;
  contactId: string | null;
  /** Recipient of the original confirmed send. Never changed silently. */
  recipientEmailSnapshot: string;
  recipientNameSnapshot: string | null;
  /** Subject of the original conversation; every follow up continues it. */
  subject: string;
  service: ServiceKey;
  language: MailLanguage;
  gmailThreadId: string;
  status: FollowUpSequenceStatus;
  /** Step in play (1 to 3), null once the sequence ended. */
  currentStep: number | null;
  maxSteps: number;
  origin: 'automatic' | 'manual';
  pauseReason: FollowUpPauseReason | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  stoppedBy: 'berk' | 'system' | null;
  steps: FollowUpStep[];
}

export const FINISHED_SEQUENCE: readonly FollowUpSequenceStatus[] = ['completed_replied', 'completed_no_reply', 'stopped'];
const OPEN_STEP: readonly FollowUpStepStatus[] = ['pending', 'scheduled', 'prepared', 'approved'];
const CURRENT_STEP: readonly FollowUpStepStatus[] = ['scheduled', 'prepared', 'approved'];

export const isOpenStep = (s: FollowUpStep) => OPEN_STEP.includes(s.status);
export const isFinished = (seq: Pick<FollowUpSequence, 'status'>) => FINISHED_SEQUENCE.includes(seq.status);

/** The step Berk works on now (scheduled, prepared or approved), if any. */
export function currentStepOf(seq: Pick<FollowUpSequence, 'steps'>): FollowUpStep | null {
  return seq.steps.find((s) => CURRENT_STEP.includes(s.status)) ?? null;
}

export const DAY_MS = 86_400_000;
export const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();

export const stepLabel = (n: number) => `${n}. Takip`;

// ---------- Sales status rules ----------

/** Stages in which a follow up sequence may continue (only after a real first email was sent). */
export const FOLLOW_UP_ELIGIBLE_STATUSES: readonly SalesStatus[] = ['found', 'researched', 'first_contact'];

export type StatusRule = 'continue' | 'pause' | 'stop' | 'reply';

/**
 * What a company's sales status means for its sequence. Never moves the sales status itself.
 *   İlk Temas (or earlier, after a real send) → continue
 *   Şimdilik Bekle                            → pause (resumed only by Berk)
 *   Yanıt Geldi                               → completed by reply
 *   later stages and other side states        → stop (never resumed automatically)
 */
export function statusRule(status: SalesStatus): StatusRule {
  if (FOLLOW_UP_ELIGIBLE_STATUSES.includes(status)) return 'continue';
  if (status === 'later') return 'pause';
  if (status === 'replied') return 'reply';
  return 'stop';
}

// ---------- Eligibility (blockers) ----------

export interface FollowUpFacts {
  company: Company;
  /** Every send of the company (any status). */
  sends: readonly OutboundMessage[];
  /** Stored messages of the sequence's Gmail thread. */
  threadMessages: readonly ThreadMessage[];
  settings: FollowUpSettings;
}

/** Recipient of the original send still a stored contact with that (valid) address. */
export function recipientAvailable(seq: Pick<FollowUpSequence, 'recipientEmailSnapshot'>, company: Company): boolean {
  const want = seq.recipientEmailSnapshot.trim().toLowerCase();
  return company.contacts.some((c) => isValidEmail(c.email) && c.email!.trim().toLowerCase() === want);
}

/**
 * Why the sequence cannot move forward right now (Turkish), empty when nothing blocks it.
 * Covers everything except the due date itself and the stored sequence status.
 */
export function followUpBlockers(seq: FollowUpSequence, facts: FollowUpFacts): string[] {
  const out: string[] = [];
  if (facts.threadMessages.some((m) => m.direction === 'inbound')) out.push('Bu konuşmada yanıt var; takip gönderilmez.');
  const rule = statusRule(facts.company.status);
  if (rule !== 'continue') out.push('Şirketin satış durumu takip için uygun değil.');
  const unresolved = facts.sends.find((s) => (s.status === 'ambiguous' || s.status === 'sending') && (s.gmailThreadId === null || s.gmailThreadId === seq.gmailThreadId));
  if (unresolved) out.push(unresolved.status === 'sending' ? 'Bir gönderim sürüyor; sonucu beklenmeli.' : 'Önceki bir gönderimin sonucu belirsiz (Kontrol gerekiyor). Önce onu çöz.');
  if (!recipientAvailable(seq, facts.company)) out.push(`Asıl alıcı (${seq.recipientEmailSnapshot}) artık şirketin kayıtlı kişileri arasında geçerli bir adresle yok. KITE başka bir alıcı tahmin etmez; karar ver.`);
  return out;
}

export function effectiveStatus(seq: FollowUpSequence, blockers: readonly string[]): FollowUpEffectiveStatus {
  if (seq.status === 'active' && blockers.length > 0) return 'blocked';
  return seq.status;
}

// ---------- Queue ----------

/**
 * due       → Takip Zamanı Gelenler: due, nothing blocks it, no draft yet
 * upcoming  → Yaklaşan Takipler: scheduled for later
 * prepared  → Taslak Hazır: draft prepared, not approved yet
 * approved  → Onay Bekliyor: approved, waiting for Berk's final send confirmation
 * attention → Dikkat Gerekenler: paused or blocked
 * finished  → Takip Tamamlandı: replied, completed or stopped
 */
export const FOLLOW_UP_QUEUE_GROUPS = ['due', 'upcoming', 'prepared', 'approved', 'attention', 'finished'] as const;
export type FollowUpQueueGroup = (typeof FOLLOW_UP_QUEUE_GROUPS)[number];

export const FOLLOW_UP_QUEUE_LABELS: Record<FollowUpQueueGroup, string> = {
  due: 'Takip Zamanı Gelenler',
  upcoming: 'Yaklaşan Takipler',
  prepared: 'Taslak Hazır',
  approved: 'Onay Bekliyor',
  attention: 'Dikkat Gerekenler',
  finished: 'Takip Tamamlandı',
};

export function queueGroup(seq: FollowUpSequence, blockers: readonly string[], now: string): FollowUpQueueGroup {
  if (isFinished(seq)) return 'finished';
  if (seq.status === 'paused' || blockers.length > 0) return 'attention';
  const step = currentStepOf(seq);
  if (!step) return 'attention';
  if (step.status === 'approved') return 'approved';
  if (step.status === 'prepared') return 'prepared';
  return step.dueAt && step.dueAt <= now ? 'due' : 'upcoming';
}

/** Browser view of one sequence: the stored record plus what the server derived from it. */
export interface FollowUpSequenceView extends FollowUpSequence {
  effectiveStatus: FollowUpEffectiveStatus;
  blockers: string[];
  queueGroup: FollowUpQueueGroup;
  /** True when the current step's due date has been reached. */
  isDue: boolean;
  /** Last confirmed outbound message of the conversation (first contact or follow up). */
  lastSentAt: string | null;
  replied: boolean;
}

/** First contact sends that can get a plan with "Takip Planı Oluştur". */
export interface FollowUpPlanCandidate {
  companyId: string;
  outboundMessageId: string;
  sentAt: string;
}

export interface FollowUpOverview {
  now: string;
  settings: FollowUpSettings;
  sequences: FollowUpSequenceView[];
  candidates: FollowUpPlanCandidate[];
}

// ---------- Errors ----------

export type FollowUpErrorCode =
  | 'followup_not_found'
  | 'followup_disabled'
  | 'followup_not_active'
  | 'followup_not_due'
  | 'followup_blocked'
  | 'followup_wrong_state'
  | 'followup_exists'
  | 'followup_not_eligible'
  | 'followup_reply_found'
  | 'followup_check_failed'
  | 'followup_thread_headers'
  | 'followup_invalid_date'
  | 'followup_subject_locked';

export const FOLLOW_UP_ERROR_MESSAGES: Record<FollowUpErrorCode, string> = {
  followup_not_found: 'Takip planı veya adımı bulunamadı.',
  followup_disabled: "Takip sistemi kapalı. Ayarlar & Otomasyon'dan açabilirsin.",
  followup_not_active: 'Bu takip planı aktif değil.',
  followup_not_due: 'Bu takibin zamanı henüz gelmedi.',
  followup_blocked: 'Bu takip şu anda ilerletilemez.',
  followup_wrong_state: 'Bu adım bu işlem için uygun durumda değil.',
  followup_exists: 'Bu gönderim için zaten bir takip planı var.',
  followup_not_eligible: 'Bu şirket için takip planı oluşturulamaz.',
  followup_reply_found: "Gmail'de yeni bir yanıt bulundu. Takip maili gönderilmedi ve kalan takipler durduruldu.",
  followup_check_failed: "Gmail konuşması kontrol edilemedi. Yeni bir yanıt olup olmadığı bilinmediği için takip maili gönderilmedi.",
  followup_thread_headers: 'Asıl mailin konuşma bilgileri (Message-ID) okunamadı; takip aynı konuşmaya bağlanamayacağı için gönderilmedi.',
  followup_invalid_date: 'Geçerli, ileri bir tarih seç.',
  followup_subject_locked: 'Takip mailleri mevcut konuşmanın konusunu korur; konu değiştirilemez.',
};
