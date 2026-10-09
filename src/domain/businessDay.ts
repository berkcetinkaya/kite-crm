// Business calendar and work thresholds (Phase 10, shared since Phase 11). Ana Sayfa, İşler and every
// work-item rule use these helpers, so "today", "overdue" and "upcoming" mean the same everywhere.

/** Business calendar for "today" / "overdue". */
export const BUSINESS_TIME_ZONE = 'Europe/Istanbul';

/** A sent proposal waiting this many days for a decision needs attention. */
export const PROPOSAL_WAITING_DAYS = 7;
/** An open-stage company with no movement for this many days is "stalled". */
export const STALLED_DAYS = 14;
/** Overdue by MORE than this many days is critical (next actions, manual tasks). */
export const CRITICAL_OVERDUE_DAYS = 3;
/** "Yaklaşan" window: due within this many days after today. */
export const UPCOMING_DAYS = 7;

// ---------- Sales intelligence (Phase 14) ----------

/** No meaningful activity for this many days: an open deal is cooling; forward events within it mean progress. */
export const COOLING_DAYS = 7;
/** A reply left without a response (send, thread reply, meeting or proposal) this many days is cooling. */
export const REPLY_RESPONSE_DAYS = 3;
/** A first contact draft waiting this many days for approval is flagged. */
export const DRAFT_APPROVAL_WAITING_DAYS = 2;
/** A due follow up left this many days is late (cooling). */
export const LATE_FOLLOW_UP_DAYS = 3;
/** A planned meeting within this many days raises priority (preparation). */
export const MEETING_SOON_DAYS = 2;
/** Proposal state: sent fewer than this many days ago is "Yeni gönderildi". */
export const NEW_PROPOSAL_DAYS = 3;
/** Opportunity score from which a company counts as high potential (when no potential level is set). */
export const HIGH_POTENTIAL_SCORE = 70;

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "YYYY-MM-DD" of an instant in the business time zone. */
export const dayKey = (iso: string | Date): string => dayFormat.format(typeof iso === 'string' ? new Date(iso) : iso);

const keyToUtc = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

/** Whole calendar days from `fromIso` to `toIso` (business time zone; negative when `fromIso` is later). */
export const daysBetween = (fromIso: string, toIso: string): number => Math.round((keyToUtc(dayKey(toIso)) - keyToUtc(dayKey(fromIso))) / 86_400_000);

/** Adds days to a "YYYY-MM-DD" key. */
export const addDaysToKey = (key: string, days: number): string => new Date(keyToUtc(key) + days * 86_400_000).toISOString().slice(0, 10);

/** ISO instant of today's 00:00 in the business time zone (İstanbul is UTC+3 all year since 2016). */
export const startOfBusinessDayIso = (nowIso: string): string => new Date(`${dayKey(nowIso)}T00:00:00+03:00`).toISOString();

/** Where a due date falls relative to today. */
export type DueBucket = 'overdue' | 'today' | 'upcoming' | 'later' | 'undated';

export function dueBucket(dueAt: string | null | undefined, nowIso: string): DueBucket {
  if (!dueAt) return 'undated';
  const k = dayKey(dueAt);
  const today = dayKey(nowIso);
  if (k < today) return 'overdue';
  if (k === today) return 'today';
  return k <= addDaysToKey(today, UPCOMING_DAYS) ? 'upcoming' : 'later';
}
