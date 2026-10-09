// Meaningful sales activity (Phase 10 aging, shared since Phase 14). Pure: one index over the
// snapshot's sends, thread messages, meetings and proposals, then per-company dates and ages.
//
// Counts as meaningful activity:
//   inbound reply · confirmed send (first contact or follow up) · meeting booked · meeting held ·
//   proposal created / sent / accepted / rejected · stage movement into the current open stage ·
//   a recorded external contact (WhatsApp, phone, in person: Berk's manual "Harici temas").
// Never counts: next action edits, notes, contact edits, score edits, draft generation or approval.
// "Forward" activity (used for İlerliyor): reply, meeting booked or held, proposal sent or accepted,
// stage movement, external contact. Our own sends are activity but not progress. An external contact
// also counts as our response to an earlier reply (it is never treated as an email).
import type { Company } from './company';
import { daysBetween, STALLED_DAYS } from './businessDay';
import { latestExternalContact } from './externalContact';
import { isOpenSalesStage, parseStatusChange } from './dashboard';
import type { OutboundMessage, ThreadMessage } from './outreach';
import type { Meeting, Proposal } from './sales';

export const latest = (values: (string | null | undefined)[]): string | null => values.reduce<string | null>((m, v) => (v && (!m || v > m) ? v : m), null);
export const daysSince = (iso: string | null | undefined, now: string): number | null => (iso ? Math.max(0, daysBetween(iso, now)) : null);

/**
 * When the company entered its current stage: the latest `status_changed` entry into it, or its
 * creation when no status change was ever recorded. Null when history cannot be read reliably.
 */
export function stageEnteredAt(company: Pick<Company, 'status' | 'history' | 'createdAt'>): string | null {
  const changes = company.history.filter((h) => h.type === 'status_changed');
  if (changes.length === 0) return company.createdAt;
  const parsed = changes.map((h) => ({ at: h.createdAt, change: parseStatusChange(h.description) }));
  const into = parsed.filter((p) => p.change?.to === company.status).map((p) => p.at);
  if (into.length) return latest(into);
  // Status changes exist but none leads to the current stage: unreadable history, do not guess.
  return null;
}

export type ActivityKind = 'reply' | 'send' | 'thread_reply' | 'meeting_booked' | 'meeting_held' | 'proposal' | 'external' | 'stage' | 'created';
export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  reply: 'Yanıt geldi',
  send: 'Mail gönderildi',
  thread_reply: 'Yazışmada yanıt verildi',
  meeting_booked: 'Görüşme planlandı',
  meeting_held: 'Görüşme yapıldı',
  proposal: 'Teklif güncellendi',
  external: 'Harici temas',
  stage: 'Aşama değişti',
  created: 'Şirket eklendi',
};

interface CompanyDates {
  lastSent: string | null;
  lastInbound: string | null;
  lastThreadOutbound: string | null;
  lastMeetingHeld: string | null;
  lastMeetingBooked: string | null;
  lastProposalMove: string | null;
  lastProposalForward: string | null;
}

/** Per-company latest dates, built once per snapshot (no per-company queries). */
export type ActivityIndex = Map<string, CompanyDates>;

export function buildActivityIndex(snap: { sends: readonly OutboundMessage[]; messages: readonly ThreadMessage[]; meetings: readonly Meeting[]; proposals: readonly Proposal[] }): ActivityIndex {
  const idx: ActivityIndex = new Map();
  const get = (id: string) => {
    let d = idx.get(id);
    if (!d) idx.set(id, (d = { lastSent: null, lastInbound: null, lastThreadOutbound: null, lastMeetingHeld: null, lastMeetingBooked: null, lastProposalMove: null, lastProposalForward: null }));
    return d;
  };
  const bump = (d: CompanyDates, key: keyof CompanyDates, at: string | null | undefined) => {
    if (at && (!d[key] || at > d[key]!)) d[key] = at;
  };
  for (const s of snap.sends) if (s.status === 'sent') bump(get(s.companyId), 'lastSent', s.sentAt);
  for (const m of snap.messages) bump(get(m.companyId), m.direction === 'inbound' ? 'lastInbound' : 'lastThreadOutbound', m.messageAt);
  for (const m of snap.meetings) {
    if (m.status === 'completed') bump(get(m.companyId), 'lastMeetingHeld', m.scheduledAt);
    if (m.status === 'planned') bump(get(m.companyId), 'lastMeetingBooked', m.createdAt);
  }
  for (const p of snap.proposals) {
    const d = get(p.companyId);
    bump(d, 'lastProposalMove', latest([p.createdAt, p.sentAt, p.decidedAt]));
    bump(d, 'lastProposalForward', latest([p.sentAt, p.status === 'accepted' ? p.decidedAt : null]));
  }
  return idx;
}

export interface CompanyActivity {
  stageEnteredAt: string | null;
  daysInStage: number | null;
  lastSentAt: string | null;
  lastReplyAt: string | null;
  lastMeetingAt: string | null;
  /** Latest meaningful activity (Phase 10 rule) and what it was. */
  lastActivityAt: string | null;
  lastActivityKind: ActivityKind | null;
  daysSinceActivity: number | null;
  /** Latest forward event (reply, meeting booked or held, proposal sent or accepted, stage movement). */
  lastForwardAt: string | null;
  /** Latest response from our side: send, thread reply, meeting booked or held, proposal, external contact. */
  lastResponseAt: string | null;
  stalled: boolean;
}

/** Phase 10 aging for one company, extended with the activity kind and forward / response dates. */
export function companyActivity(c: Pick<Company, 'id' | 'status' | 'history' | 'createdAt' | 'lastContactAt'>, idx: ActivityIndex, now: string): CompanyActivity {
  const d = idx.get(c.id);
  const entered = stageEnteredAt(c);
  const sentAt = d?.lastSent ?? c.lastContactAt ?? null;
  const replyAt = d?.lastInbound ?? null;
  const heldAt = d?.lastMeetingHeld ?? null;
  const bookedAt = d?.lastMeetingBooked ?? null;
  const externalAt = latestExternalContact(c)?.at ?? null;
  // Most informative first: on equal timestamps (a reply and the stage change it caused) the earlier entry wins.
  const candidates: [ActivityKind, string | null][] = [
    ['reply', replyAt],
    ['meeting_held', heldAt],
    ['meeting_booked', bookedAt],
    ['proposal', d?.lastProposalMove ?? null],
    ['external', externalAt],
    ['send', sentAt],
    // No recorded stage change: the company's creation is its stage entry.
    [c.history.some((h) => h.type === 'status_changed') ? 'stage' : 'created', entered ?? c.createdAt],
  ];
  let lastActivityAt: string | null = null;
  let lastActivityKind: ActivityKind | null = null;
  for (const [kind, at] of candidates) if (at && (!lastActivityAt || at > lastActivityAt)) [lastActivityAt, lastActivityKind] = [at, kind];
  const daysInStage = daysSince(entered, now);
  const daysSinceActivity = daysSince(lastActivityAt, now);
  return {
    stageEnteredAt: entered,
    daysInStage,
    lastSentAt: sentAt,
    lastReplyAt: replyAt,
    lastMeetingAt: heldAt,
    lastActivityAt,
    lastActivityKind,
    daysSinceActivity,
    lastForwardAt: latest([replyAt, heldAt, bookedAt, d?.lastProposalForward, externalAt, isOpenSalesStage(c.status) ? entered : null]),
    lastResponseAt: latest([d?.lastSent, d?.lastThreadOutbound, bookedAt, heldAt, d?.lastProposalMove, externalAt]),
    stalled: isOpenSalesStage(c.status) && daysInStage !== null && daysInStage >= STALLED_DAYS && daysSinceActivity !== null && daysSinceActivity >= STALLED_DAYS,
  };
}
