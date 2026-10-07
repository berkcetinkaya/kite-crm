// Ana Sayfa dashboard computation (Phase 10). Pure: (snapshot of existing data, now, range) → Dashboard.
// Nothing is stored or written; every age is derived at request time.
import type { Company } from '../../src/domain/company';
import { customerBlockers, onboardingProgress, overdueOnboardingItems, CUSTOMER_STATUSES } from '../../src/domain/customers';
import {
  dayKey,
  daysBetween,
  addDaysToKey,
  inWindow,
  isOpenSalesStage,
  parseStatusChange,
  rangeWindow,
  STALLED_DAYS,
  SUMMARY_STAGES,
  type CompanyAging,
  type CurrencyValue,
  type Dashboard,
  type DashboardRange,
  type MeetingRow,
  type PipelineValue,
} from '../../src/domain/dashboard';
import type { OutboundMessage, ThreadMessage } from '../../src/domain/outreach';
import { CURRENCIES, PROPOSAL_STATUSES, type Meeting, type Proposal } from '../../src/domain/sales';
import { compareTr } from '../../src/lib/text';
import { attentionFromWork, collectWorkItems, type WorkSnapshot } from '../work/derive';

export interface DashboardSnapshot extends WorkSnapshot {
  sends: OutboundMessage[];
  messages: ThreadMessage[];
}

const latest = (values: (string | null | undefined)[]): string | null => values.reduce<string | null>((m, v) => (v && (!m || v > m) ? v : m), null);
const since = (iso: string | null, now: string) => (iso ? Math.max(0, daysBetween(iso, now)) : null);

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

function pipeline(proposals: Proposal[]): PipelineValue {
  const groups = new Map<string, CurrencyValue & { tax: Set<string> }>();
  for (const p of proposals) {
    const g = groups.get(p.currency) ?? { currency: p.currency, oneTimeMinor: 0, monthlyMinor: 0, proposals: 0, taxMixed: false, tax: new Set<string>() };
    for (const i of p.items) {
      if (i.billingType === 'monthly') g.monthlyMinor += i.unitAmountMinor * i.quantity;
      else g.oneTimeMinor += i.unitAmountMinor * i.quantity;
    }
    g.proposals += 1;
    if (p.taxMode !== 'unspecified') g.tax.add(p.taxMode);
    groups.set(p.currency, g);
  }
  const byCurrency = CURRENCIES.map((c) => groups.get(c))
    .filter((g): g is CurrencyValue & { tax: Set<string> } => !!g && (g.oneTimeMinor > 0 || g.monthlyMinor > 0))
    .map(({ tax, ...g }) => ({ ...g, taxMixed: tax.size > 1 }));
  return { proposals: proposals.length, byCurrency };
}

export function buildDashboard(snap: DashboardSnapshot, now: string, rangeKey: DashboardRange): Dashboard {
  const today = dayKey(now);
  const window = rangeWindow(rangeKey, now);
  const byId = new Map(snap.companies.map((c) => [c.id, c]));
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Şirket';
  // ----- Bugün: projection of the shared work items (Phase 11), same rules as İşler -----
  const workItems = collectWorkItems(snap, now);
  const attention = attentionFromWork(workItems);
  const liveCustomers = snap.customers.filter((c) => c.status !== 'completed' && c.status !== 'lost');

  // ----- Meetings card -----
  const row = (m: Meeting): MeetingRow => ({ meetingId: m.id, companyId: m.companyId, companyName: nameOf(m.companyId), scheduledAt: m.scheduledAt, type: m.type, contactName: m.contactName });
  const planned = snap.meetings.filter((m) => m.status === 'planned').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const overdueMeetings = planned.filter((m) => m.scheduledAt < now);
  const todayMeetings = planned.filter((m) => m.scheduledAt >= now && dayKey(m.scheduledAt) === today);
  const weekEnd = addDaysToKey(today, 7);
  const upcoming = planned.filter((m) => m.scheduledAt >= now && dayKey(m.scheduledAt) > today && dayKey(m.scheduledAt) <= weekEnd);

  // ----- Aging / momentum -----
  const lastSent = new Map<string, string>();
  for (const s of snap.sends) if (s.status === 'sent' && s.sentAt && (!lastSent.get(s.companyId) || s.sentAt > lastSent.get(s.companyId)!)) lastSent.set(s.companyId, s.sentAt);
  const lastReply = new Map<string, string>();
  for (const m of snap.messages) if (m.direction === 'inbound' && (!lastReply.get(m.companyId) || m.messageAt > lastReply.get(m.companyId)!)) lastReply.set(m.companyId, m.messageAt);
  const lastMeeting = new Map<string, string>();
  for (const m of snap.meetings) if (m.status === 'completed' && (!lastMeeting.get(m.companyId) || m.scheduledAt > lastMeeting.get(m.companyId)!)) lastMeeting.set(m.companyId, m.scheduledAt);
  const lastProposalMove = new Map<string, string>();
  for (const p of snap.proposals) {
    const t = latest([p.createdAt, p.sentAt, p.decidedAt]);
    if (t && (!lastProposalMove.get(p.companyId) || t > lastProposalMove.get(p.companyId)!)) lastProposalMove.set(p.companyId, t);
  }

  const aging = (c: Company): CompanyAging => {
    const entered = stageEnteredAt(c);
    const sentAt = lastSent.get(c.id) ?? c.lastContactAt ?? null;
    const replyAt = lastReply.get(c.id) ?? null;
    const meetingAt = lastMeeting.get(c.id) ?? null;
    // Planned meetings count as movement from when they were booked.
    const booked = latest(snap.meetings.filter((m) => m.companyId === c.id && m.status === 'planned').map((m) => m.createdAt));
    const activity = latest([entered ?? c.createdAt, sentAt, replyAt, meetingAt, booked, lastProposalMove.get(c.id)]);
    const daysInStage = since(entered, now);
    const daysSinceActivity = since(activity, now);
    return {
      companyId: c.id,
      name: c.name,
      status: c.status,
      owner: c.owner,
      stageEnteredAt: entered,
      daysInStage,
      lastSentAt: sentAt,
      daysSinceSend: since(sentAt, now),
      lastReplyAt: replyAt,
      daysSinceReply: since(replyAt, now),
      lastMeetingAt: meetingAt,
      daysSinceMeeting: since(meetingAt, now),
      lastActivityAt: activity,
      daysSinceActivity,
      stalled: isOpenSalesStage(c.status) && daysInStage !== null && daysInStage >= STALLED_DAYS && daysSinceActivity !== null && daysSinceActivity >= STALLED_DAYS,
      nextAction: c.nextAction ? { label: c.nextAction.label, dueAt: c.nextAction.dueAt } : null,
    };
  };
  const momentum = snap.companies
    .filter((c) => isOpenSalesStage(c.status))
    .map(aging)
    .sort((a, b) => (b.daysSinceActivity ?? -1) - (a.daysSinceActivity ?? -1) || compareTr(a.name, b.name));

  // ----- Sales -----
  const zeroStages = () => Object.fromEntries(SUMMARY_STAGES.map((s) => [s, 0])) as Dashboard['sales']['stageCounts'];
  const stageCounts = zeroStages();
  for (const c of snap.companies) if (c.status in stageCounts) stageCounts[c.status as keyof typeof stageCounts] += 1;
  const stageEntries = zeroStages();
  for (const c of snap.companies)
    for (const h of c.history) {
      if (h.type !== 'status_changed' || !inWindow(h.createdAt, window)) continue;
      const to = parseStatusChange(h.description)?.to;
      if (to && to in stageEntries) stageEntries[to as keyof typeof stageEntries] += 1;
    }

  // ----- Proposals -----
  const statusCounts = Object.fromEntries(PROPOSAL_STATUSES.map((s) => [s, 0])) as Dashboard['proposals']['statusCounts'];
  for (const p of snap.proposals) statusCounts[p.status] += 1;

  // ----- Customers -----
  const customerCounts = Object.fromEntries(CUSTOMER_STATUSES.map((s) => [s, 0])) as Dashboard['customers']['statusCounts'];
  for (const c of snap.customers) customerCounts[c.status] += 1;

  // ----- Follow-up queue -----
  const followUps = { due: 0, upcoming: 0, prepared: 0, approved: 0, attention: 0 };
  for (const s of snap.followUps) if (s.queueGroup !== 'finished') followUps[s.queueGroup] += 1;

  return {
    now,
    range: { key: rangeKey, ...window },
    attention,
    openWorkCount: workItems.length,
    sales: {
      stageCounts,
      stalledCount: momentum.filter((m) => m.stalled).length,
      activity: {
        newCompanies: snap.companies.filter((c) => inWindow(c.createdAt, window)).length,
        stageEntries,
        sends: snap.sends.filter((s) => s.status === 'sent' && inWindow(s.sentAt, window)).length,
        replies: snap.messages.filter((m) => m.direction === 'inbound' && inWindow(m.messageAt, window)).length,
        meetingsHeld: snap.meetings.filter((m) => m.status === 'completed' && inWindow(m.scheduledAt, window)).length,
        proposalsSent: snap.proposals.filter((p) => inWindow(p.sentAt, window)).length,
        proposalsAccepted: snap.proposals.filter((p) => p.status === 'accepted' && inWindow(p.decidedAt, window)).length,
        proposalsRejected: snap.proposals.filter((p) => p.status === 'rejected' && inWindow(p.decidedAt, window)).length,
        newCustomers: snap.customers.filter((c) => inWindow(c.onboardingStartedAt, window)).length,
      },
    },
    proposals: {
      statusCounts,
      awaitingDecision: pipeline(snap.proposals.filter((p) => p.status === 'sent')),
      acceptedInRange: pipeline(snap.proposals.filter((p) => p.status === 'accepted' && inWindow(p.decidedAt, window))),
    },
    customers: {
      statusCounts: customerCounts,
      blocked: liveCustomers.filter((c) => customerBlockers(c, now).length > 0).length,
      overdueItems: liveCustomers.reduce((n, c) => n + overdueOnboardingItems(c.onboarding, now).length, 0),
      accessProblems: liveCustomers.reduce((n, c) => n + c.access.filter((a) => a.status === 'problem').length, 0),
      activeServices: liveCustomers.reduce((n, c) => n + c.services.filter((s) => s.status === 'active').length, 0),
      noNextAction: snap.customers.filter((c) => (c.status === 'active' || c.status === 'on_hold') && !byId.get(c.companyId)?.nextAction).length,
      onboarding: snap.customers
        .filter((c) => c.status === 'onboarding')
        .map((c) => {
          const p = onboardingProgress(c.onboarding);
          return { customerId: c.id, companyId: c.companyId, name: nameOf(c.companyId), done: p.done, total: p.total, daysSinceStart: since(c.onboardingStartedAt, now) ?? 0, blocked: customerBlockers(c, now).length > 0 };
        })
        .sort((a, b) => b.daysSinceStart - a.daysSinceStart || compareTr(a.name, b.name)),
    },
    followUps,
    meetings: { today: todayMeetings.map(row), overdueWithoutOutcome: overdueMeetings.map(row), upcoming: upcoming.map(row) },
    momentum,
  };
}
