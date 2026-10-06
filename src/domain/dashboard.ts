// Ana Sayfa dashboard (Phase 10): read-only reporting over existing data. Shared by the server (which
// computes everything) and the browser (labels, links). Nothing here is stored.
//
// Not analytics: no conversion percentages, win rates, average stage durations, forecasts, FX or
// revenue. Current-state widgets ignore the selected range; only the "Seçili dönem" section uses it.
import type { CustomerStatus } from './customers';
import type { Currency, MeetingType, ProposalStatus } from './sales';
import { SALES_STATUS, type SalesStatus } from './salesStatus';
import type { FollowUpQueueGroup } from './followUp';

// ---------- Thresholds (approved for Phase 10) ----------

/** A sent proposal waiting this many days for a decision needs attention. */
export const PROPOSAL_WAITING_DAYS = 7;
/** An open-stage company with no movement for this many days is "stalled". */
export const STALLED_DAYS = 14;
/** A next action overdue by MORE than this many days is critical. */
export const CRITICAL_OVERDUE_DAYS = 3;

/** Business calendar for "today" / "overdue". */
export const DASHBOARD_TIME_ZONE = 'Europe/Istanbul';

/** Open sales stages: the only stages that can be "stalled" (never Müşteri or side states). */
export const OPEN_SALES_STAGES = ['first_contact', 'replied', 'meeting', 'proposal', 'awaiting_decision'] as const satisfies readonly SalesStatus[];
export type OpenSalesStage = (typeof OPEN_SALES_STAGES)[number];
export const isOpenSalesStage = (s: SalesStatus): s is OpenSalesStage => (OPEN_SALES_STAGES as readonly SalesStatus[]).includes(s);

/** Stages shown in Satış Özeti (current counts only). */
export const SUMMARY_STAGES = [...OPEN_SALES_STAGES, 'client', 'lost'] as const satisfies readonly SalesStatus[];

/** Closed for sales attention: no next-action or proposal rows. */
export const CLOSED_COMPANY_STATUSES: readonly SalesStatus[] = ['lost', 'disqualified', 'not_interested'];

// ---------- Range ----------

export const DASHBOARD_RANGES = ['7d', '30d', '90d', 'month'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = { '7d': 'Son 7 Gün', '30d': 'Son 30 Gün', '90d': 'Son 90 Gün', month: 'Bu Ay' };
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = '30d';
export const isDashboardRange = (v: unknown): v is DashboardRange => typeof v === 'string' && (DASHBOARD_RANGES as readonly string[]).includes(v);

// ---------- Business days ----------

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: DASHBOARD_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "YYYY-MM-DD" of an instant in the business time zone. */
export const dayKey = (iso: string | Date): string => dayFormat.format(typeof iso === 'string' ? new Date(iso) : iso);

const keyToUtc = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

/** Whole calendar days from `fromIso` to `toIso` (business time zone; negative when `fromIso` is later). */
export const daysBetween = (fromIso: string, toIso: string): number => Math.round((keyToUtc(dayKey(toIso)) - keyToUtc(dayKey(fromIso))) / 86_400_000);

/** Adds days to a "YYYY-MM-DD" key. */
export const addDaysToKey = (key: string, days: number): string => new Date(keyToUtc(key) + days * 86_400_000).toISOString().slice(0, 10);

/** Inclusive day-key window of a range ending today. */
export function rangeWindow(range: DashboardRange, nowIso: string): { from: string; to: string } {
  const to = dayKey(nowIso);
  if (range === 'month') return { from: `${to.slice(0, 8)}01`, to };
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return { from: addDaysToKey(to, -(days - 1)), to };
}

export const inWindow = (iso: string | null | undefined, w: { from: string; to: string }) => {
  if (!iso) return false;
  const k = dayKey(iso);
  return k >= w.from && k <= w.to;
};

// ---------- Stage history ----------

const LABEL_TO_STATUS = new Map(Object.entries(SALES_STATUS).map(([k, v]) => [v.label, k as SalesStatus]));
const STATUS_CHANGE = /^Durum (.+) → (.+) olarak değiştirildi$/;

/** Parses a `status_changed` history text ("Durum A → B olarak değiştirildi"); null when unknown. */
export function parseStatusChange(description: string): { from: SalesStatus; to: SalesStatus } | null {
  const m = STATUS_CHANGE.exec(description);
  if (!m) return null;
  const from = LABEL_TO_STATUS.get(m[1]);
  const to = LABEL_TO_STATUS.get(m[2]);
  return from && to ? { from, to } : null;
}

// ---------- Attention queue ----------

export const ATTENTION_KINDS = [
  'access_problem',
  'onboarding_overdue',
  'follow_up_due',
  'follow_up_blocked',
  'meeting_no_outcome',
  'next_action_overdue',
  'proposal_waiting',
  'next_action_today',
  'meeting_today',
  'customer_no_next_action',
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_KIND_LABELS: Record<AttentionKind, string> = {
  access_problem: 'Erişim sorunu',
  onboarding_overdue: 'Gecikmiş onboarding',
  follow_up_due: 'Takip zamanı',
  follow_up_blocked: 'Takip engelli',
  meeting_no_outcome: 'Görüşme sonucu yok',
  next_action_overdue: 'Gecikmiş adım',
  proposal_waiting: 'Teklif bekliyor',
  next_action_today: 'Bugünkü adım',
  meeting_today: 'Bugün görüşme',
  customer_no_next_action: 'Sonraki adım yok',
};

export type AttentionSeverity = 1 | 2 | 3;
export const SEVERITY_LABELS: Record<AttentionSeverity, string> = { 1: 'Kritik', 2: 'Bugün', 3: 'Takip' };

/** Where a row leads; the browser turns it into a route or opens the company drawer. */
export type DashboardLink =
  | { type: 'company'; companyId: string }
  | { type: 'customer'; customerId: string }
  | { type: 'proposal'; proposalId: string }
  | { type: 'mail'; companyId: string };

export interface AttentionItem {
  /** Stable, unique per signal (e.g. "proposal:prp_…"). */
  key: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  companyId: string;
  companyName: string;
  description: string;
  /** The relevant date (due date, meeting time, send date…). */
  at: string | null;
  /** Days overdue / waiting (0 = today); null when not applicable. */
  ageDays: number | null;
  owner: string | null;
  link: DashboardLink;
}

// ---------- Snapshot ----------

export interface CompanyAging {
  companyId: string;
  name: string;
  status: SalesStatus;
  owner: string | null;
  stageEnteredAt: string | null;
  daysInStage: number | null;
  lastSentAt: string | null;
  daysSinceSend: number | null;
  lastReplyAt: string | null;
  daysSinceReply: number | null;
  lastMeetingAt: string | null;
  daysSinceMeeting: number | null;
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  stalled: boolean;
  nextAction: { label: string; dueAt: string | null } | null;
}

export interface CurrencyValue {
  currency: Currency;
  oneTimeMinor: number;
  monthlyMinor: number;
  proposals: number;
  /** KDV dahil and hariç proposals in the same group (amounts are as entered). */
  taxMixed: boolean;
}

export interface PipelineValue {
  proposals: number;
  /** Only currencies with a non-zero amount, in CURRENCIES order. */
  byCurrency: CurrencyValue[];
}

export interface MeetingRow {
  meetingId: string;
  companyId: string;
  companyName: string;
  scheduledAt: string;
  type: MeetingType;
  contactName: string | null;
}

export interface OnboardingRow {
  customerId: string;
  companyId: string;
  name: string;
  done: number;
  total: number;
  daysSinceStart: number;
  blocked: boolean;
}

export interface Dashboard {
  now: string;
  range: { key: DashboardRange; from: string; to: string };
  attention: AttentionItem[];
  sales: {
    stageCounts: Record<(typeof SUMMARY_STAGES)[number], number>;
    stalledCount: number;
    /** Range based: plain counts of what happened, never ratios. */
    activity: {
      newCompanies: number;
      stageEntries: Record<(typeof SUMMARY_STAGES)[number], number>;
      sends: number;
      replies: number;
      meetingsHeld: number;
      proposalsSent: number;
      proposalsAccepted: number;
      proposalsRejected: number;
      newCustomers: number;
    };
  };
  proposals: {
    statusCounts: Record<ProposalStatus, number>;
    awaitingDecision: PipelineValue;
    /** Accepted with a decision date inside the range. */
    acceptedInRange: PipelineValue;
  };
  customers: {
    statusCounts: Record<CustomerStatus, number>;
    blocked: number;
    overdueItems: number;
    accessProblems: number;
    activeServices: number;
    noNextAction: number;
    onboarding: OnboardingRow[];
  };
  followUps: Record<Exclude<FollowUpQueueGroup, 'finished'>, number>;
  meetings: { today: MeetingRow[]; overdueWithoutOutcome: MeetingRow[]; upcoming: MeetingRow[] };
  momentum: CompanyAging[];
}
