// Phase 10: pure dashboard rules (attention queue, deduplication, aging, aggregates, ranges).
import { describe, expect, it } from 'vitest';
import type { Company, CompanyHistoryEntry } from '../../src/domain/company';
import type { Customer } from '../../src/domain/customers';
import { dayKey, daysBetween, parseStatusChange, rangeWindow, type AttentionItem } from '../../src/domain/dashboard';
import type { FollowUpSequenceView } from '../../src/domain/followUp';
import type { OutboundMessage, ThreadMessage } from '../../src/domain/outreach';
import type { Meeting, Proposal } from '../../src/domain/sales';
import type { SalesStatus } from '../../src/domain/salesStatus';
import { buildDashboard, stageEnteredAt, type DashboardSnapshot } from './dashboard';

const NOW = '2026-10-20T09:00:00.000Z'; // 12:00 in İstanbul
const daysAgo = (d: number, hour = 9) => new Date(Date.parse(`2026-10-20T0${hour}:00:00.000Z`) - d * 86_400_000).toISOString();

let n = 0;
const hist = (description: string, at: string, type: CompanyHistoryEntry['type'] = 'status_changed'): CompanyHistoryEntry => ({ id: `evt_${++n}`, type, description, createdAt: at, author: 'Berk Çetinkaya' });
const company = (id: string, status: SalesStatus, over: Partial<Company> = {}): Company =>
  ({ id, name: id.replace('cmp_', ''), status, owner: 'Berk Çetinkaya', history: [], lastContactAt: null, nextAction: null, createdAt: daysAgo(60), contacts: [], notes: [], opportunities: [], ...over }) as unknown as Company;
const proposal = (id: string, companyId: string, over: Partial<Proposal> = {}): Proposal => ({
  id,
  companyId,
  title: `Teklif ${id}`,
  currency: 'TRY',
  contractMonths: null,
  validUntil: null,
  notes: '',
  taxMode: 'excluded',
  taxRateBp: null,
  status: 'sent',
  sentAt: daysAgo(8),
  decidedAt: null,
  lossReason: null,
  createdAt: daysAgo(10),
  updatedAt: daysAgo(8),
  items: [],
  ...over,
});
const item = (billingType: 'monthly' | 'one_time', unitAmountMinor: number, quantity = 1) => ({ id: `pit_${++n}`, proposalId: 'x', position: 0, service: 'meta_ads' as const, description: '', billingType, unitAmountMinor, quantity, createdAt: NOW, updatedAt: NOW });
const meeting = (id: string, companyId: string, scheduledAt: string, status: Meeting['status'] = 'planned'): Meeting => ({
  id, companyId, scheduledAt, type: 'online', status, contactId: null, contactName: 'Aytül', contactEmail: null, notes: '', outcome: '', nextActionLabel: null, nextActionDueAt: null, completedAt: status === 'completed' ? scheduledAt : null, createdAt: daysAgo(3), updatedAt: daysAgo(3),
});
const customer = (id: string, companyId: string, over: Partial<Customer> = {}): Customer => ({
  id, companyId, status: 'onboarding', startDate: daysAgo(5), endDate: null, primaryContactId: null, primaryContactName: null, primaryContactEmail: null, sourceProposalId: null, commercialNotes: '', operationalNotes: '', onboardingStartedAt: daysAgo(5), onboardingCompletedAt: null, createdAt: daysAgo(5), updatedAt: daysAgo(5), services: [], onboarding: [], access: [], ...over,
});
const empty = (): DashboardSnapshot => ({ companies: [], sends: [], messages: [], followUps: [], meetings: [], proposals: [], customers: [] });
const kinds = (a: AttentionItem[]) => a.map((x) => `${x.kind}:${x.severity}`);

describe('business days and ranges', () => {
  it('uses the İstanbul calendar day', () => {
    expect(dayKey('2026-10-06T20:59:00.000Z')).toBe('2026-10-06');
    expect(dayKey('2026-10-06T21:00:00.000Z')).toBe('2026-10-07');
    expect(daysBetween('2026-10-06T20:00:00.000Z', '2026-10-06T22:00:00.000Z')).toBe(1);
  });

  it('ranges end today and are inclusive', () => {
    expect(rangeWindow('7d', NOW)).toEqual({ from: '2026-10-14', to: '2026-10-20' });
    expect(rangeWindow('30d', NOW)).toEqual({ from: '2026-09-21', to: '2026-10-20' });
    expect(rangeWindow('90d', NOW).from).toBe('2026-07-23');
    expect(rangeWindow('month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-20' });
  });
});

describe('stage history', () => {
  it('parses the exact status_changed text and refuses anything else', () => {
    expect(parseStatusChange('Durum İlk Temas → Yanıt Geldi olarak değiştirildi')).toEqual({ from: 'first_contact', to: 'replied' });
    expect(parseStatusChange('Durum Karar Bekleniyor → Müşteri olarak değiştirildi')).toEqual({ from: 'awaiting_decision', to: 'client' });
    expect(parseStatusChange('Durum Foo → Yanıt Geldi olarak değiştirildi')).toBeNull();
    expect(parseStatusChange('Yanıt geldi: a@b.c')).toBeNull();
  });

  it('stage entry: latest change into the current stage, creation fallback, null when unreadable', () => {
    expect(stageEnteredAt(company('cmp_a', 'found', { createdAt: daysAgo(9) }))).toBe(daysAgo(9));
    const moved = company('cmp_b', 'replied', {
      history: [hist('Durum Bulundu → İlk Temas olarak değiştirildi', daysAgo(20)), hist('Durum İlk Temas → Yanıt Geldi olarak değiştirildi', daysAgo(12)), hist('Durum Yanıt Geldi → Görüşme olarak değiştirildi', daysAgo(6)), hist('Durum Görüşme → Yanıt Geldi olarak değiştirildi', daysAgo(2))],
    });
    expect(stageEnteredAt(moved)).toBe(daysAgo(2)); // backward move: latest entry wins
    expect(stageEnteredAt(company('cmp_c', 'meeting', { history: [hist('Durum ??? olarak değiştirildi', daysAgo(3))] }))).toBeNull();
  });
});

describe('attention queue', () => {
  it('an empty database yields an empty, valid dashboard with no invented numbers', () => {
    const d = buildDashboard(empty(), NOW, '30d');
    expect(d.attention).toEqual([]);
    expect(Object.values(d.sales.stageCounts).every((v) => v === 0)).toBe(true);
    expect(d.proposals.awaitingDecision).toEqual({ proposals: 0, byCurrency: [] });
    expect(d.customers).toMatchObject({ blocked: 0, overdueItems: 0, accessProblems: 0, activeServices: 0, noNextAction: 0, onboarding: [] });
    expect(d.followUps).toEqual({ due: 0, upcoming: 0, prepared: 0, approved: 0, attention: 0 });
    expect(d.momentum).toEqual([]);
  });

  it('a blocked customer shows its specific causes only (no generic "customer blocked" row)', () => {
    const s = empty();
    s.companies = [company('cmp_lyxa', 'client', { nextAction: { label: 'Rapor', dueAt: daysAgo(-3) } })];
    s.customers = [
      customer('cus_1', 'cmp_lyxa', {
        access: [{ id: 'acc_1', customerId: 'cus_1', position: 0, kind: 'ga4', label: 'GA4 erişimi', status: 'problem', requestedAt: daysAgo(4), receivedAt: null, notes: '', createdAt: daysAgo(5), updatedAt: daysAgo(2) }],
        onboarding: [
          { id: 'onb_1', customerId: 'cus_1', position: 0, label: 'Kickoff', status: 'pending', notes: '', dueDate: '2026-10-15T09:00:00.000Z', completedAt: null, templateKey: null, createdAt: NOW, updatedAt: NOW },
          { id: 'onb_2', customerId: 'cus_1', position: 1, label: 'Marka', status: 'in_progress', notes: '', dueDate: '2026-10-18T09:00:00.000Z', completedAt: null, templateKey: null, createdAt: NOW, updatedAt: NOW },
          { id: 'onb_3', customerId: 'cus_1', position: 2, label: 'Bitti', status: 'done', notes: '', dueDate: '2026-10-01T09:00:00.000Z', completedAt: NOW, templateKey: null, createdAt: NOW, updatedAt: NOW },
        ],
      }),
    ];
    const d = buildDashboard(s, NOW, '30d');
    expect(kinds(d.attention)).toEqual(['onboarding_overdue:1', 'access_problem:1']);
    expect(d.attention[0]).toMatchObject({ description: '2 gecikmiş adım: Kickoff, Marka', ageDays: 5, link: { type: 'customer', customerId: 'cus_1' }, owner: 'Berk Çetinkaya', companyName: 'lyxa' });
    expect(d.customers).toMatchObject({ blocked: 1, overdueItems: 2, accessProblems: 1 });
  });

  it('next actions: overdue > 3 days is critical, 1-3 days is today, due today is today; closed companies are skipped', () => {
    const s = empty();
    s.companies = [
      company('cmp_late', 'replied', { nextAction: { label: 'Ara', dueAt: daysAgo(4) } }),
      company('cmp_edge', 'replied', { nextAction: { label: 'Mail at', dueAt: daysAgo(3) } }),
      company('cmp_today', 'meeting', { nextAction: { label: 'Toplantı notu', dueAt: daysAgo(0, 7) } }),
      company('cmp_future', 'meeting', { nextAction: { label: 'Sonra', dueAt: daysAgo(-2) } }),
      company('cmp_lost', 'lost', { nextAction: { label: 'Unut', dueAt: daysAgo(10) } }),
    ];
    const d = buildDashboard(s, NOW, '30d');
    expect(d.attention.map((a) => [a.companyId, a.kind, a.severity, a.ageDays])).toEqual([
      ['cmp_late', 'next_action_overdue', 1, 4],
      ['cmp_edge', 'next_action_overdue', 2, 3],
      ['cmp_today', 'next_action_today', 2, 0],
    ]);
  });

  it('proposals: 7+ days waiting is "Bugün", an expired valid-until is "Kritik", one row per proposal', () => {
    const s = empty();
    s.companies = [company('cmp_p', 'awaiting_decision'), company('cmp_lost', 'lost')];
    s.proposals = [
      proposal('prp_wait', 'cmp_p', { sentAt: daysAgo(7) }),
      proposal('prp_fresh', 'cmp_p', { sentAt: daysAgo(6) }),
      proposal('prp_expired', 'cmp_p', { sentAt: daysAgo(9), validUntil: daysAgo(1) }),
      proposal('prp_expired_fresh', 'cmp_p', { sentAt: daysAgo(2), validUntil: daysAgo(1) }),
      proposal('prp_valid_today', 'cmp_p', { sentAt: daysAgo(2), validUntil: daysAgo(0) }),
      proposal('prp_lost_company', 'cmp_lost', { sentAt: daysAgo(30) }),
      proposal('prp_accepted', 'cmp_p', { status: 'accepted', sentAt: daysAgo(30), decidedAt: daysAgo(20) }),
    ];
    const d = buildDashboard(s, NOW, '30d');
    expect(d.attention.map((a) => [a.key, a.severity])).toEqual([
      ['proposal:prp_expired', 1],
      ['proposal:prp_expired_fresh', 1],
      ['proposal:prp_wait', 2],
    ]);
    expect(new Set(d.attention.map((a) => a.key)).size).toBe(d.attention.length);
    expect(d.attention[0].description).toMatch(/geçerlilik tarihi geçti/);
    expect(d.attention[0].link).toEqual({ type: 'proposal', proposalId: 'prp_expired' });
  });

  it('meetings, follow-ups and customers without a next action; sorted by severity then age', () => {
    const s = empty();
    s.companies = [company('cmp_m', 'meeting'), company('cmp_f', 'first_contact'), company('cmp_c', 'client')];
    s.meetings = [meeting('mtg_past', 'cmp_m', daysAgo(2)), meeting('mtg_today', 'cmp_m', '2026-10-20T13:00:00.000Z'), meeting('mtg_week', 'cmp_m', daysAgo(-3)), meeting('mtg_done', 'cmp_m', daysAgo(1), 'completed')];
    const seq = (id: string, queueGroup: FollowUpSequenceView['queueGroup'], extra: Partial<FollowUpSequenceView> = {}) =>
      ({ id, companyId: 'cmp_f', status: 'active', queueGroup, blockers: [], steps: [{ id: `${id}_1`, stepNumber: 1, status: 'scheduled', dueAt: daysAgo(1) }], ...extra }) as unknown as FollowUpSequenceView;
    s.followUps = [seq('fus_due', 'due'), seq('fus_blocked', 'attention', { blockers: ['Alıcı adresi yok'] }), seq('fus_up', 'upcoming'), seq('fus_done', 'finished')];
    s.customers = [customer('cus_a', 'cmp_c', { status: 'active' })];
    const d = buildDashboard(s, NOW, '30d');
    expect(kinds(d.attention)).toEqual(['meeting_no_outcome:2', 'follow_up_due:2', 'follow_up_blocked:2', 'meeting_today:3', 'customer_no_next_action:3']);
    expect(d.attention[1]).toMatchObject({ description: '1. takip maili zamanı geldi', ageDays: 1, link: { type: 'mail', companyId: 'cmp_f' } });
    expect(d.attention[2].description).toBe('Alıcı adresi yok');
    expect(d.followUps).toEqual({ due: 1, upcoming: 1, prepared: 0, approved: 0, attention: 1 });
    expect(d.meetings.today.map((m) => m.meetingId)).toEqual(['mtg_today']);
    expect(d.meetings.overdueWithoutOutcome.map((m) => m.meetingId)).toEqual(['mtg_past']);
    expect(d.meetings.upcoming.map((m) => m.meetingId)).toEqual(['mtg_week']);
    expect(d.customers.noNextAction).toBe(1);
  });
});

describe('aging and stalled', () => {
  it('only open sales stages can be stalled; replies come from inbound mail, not lastContactAt', () => {
    const s = empty();
    const into = (label: string, at: string) => [hist(`Durum Bulundu → ${label} olarak değiştirildi`, at)];
    s.companies = [
      company('cmp_stuck', 'first_contact', { history: into('İlk Temas', daysAgo(20)), lastContactAt: daysAgo(20) }),
      company('cmp_replied', 'replied', { history: into('Yanıt Geldi', daysAgo(20)), lastContactAt: daysAgo(25) }),
      company('cmp_client', 'client', { history: into('Müşteri', daysAgo(40)) }),
      company('cmp_later', 'later', { history: into('Şimdilik Bekle', daysAgo(40)) }),
      company('cmp_lost', 'lost', { history: into('Kaybedildi', daysAgo(40)) }),
      company('cmp_young', 'meeting', { history: into('Görüşme', daysAgo(13)) }),
    ];
    s.sends = [{ id: 'snd_1', companyId: 'cmp_stuck', status: 'sent', sentAt: daysAgo(20) } as OutboundMessage];
    s.messages = [{ id: 'msg_1', companyId: 'cmp_replied', direction: 'inbound', messageAt: daysAgo(3) } as ThreadMessage];
    const d = buildDashboard(s, NOW, '30d');
    expect(d.momentum.map((m) => m.companyId)).toEqual(['cmp_stuck', 'cmp_young', 'cmp_replied']);
    const stuck = d.momentum[0];
    expect(stuck).toMatchObject({ daysInStage: 20, daysSinceSend: 20, daysSinceReply: null, stalled: true });
    expect(d.momentum.find((m) => m.companyId === 'cmp_replied')).toMatchObject({ daysInStage: 20, daysSinceReply: 3, daysSinceSend: 25, stalled: false });
    expect(d.momentum.find((m) => m.companyId === 'cmp_young')!.stalled).toBe(false);
    expect(d.sales.stalledCount).toBe(1);
    expect(d.sales.stageCounts).toMatchObject({ first_contact: 1, replied: 1, meeting: 1, client: 1, lost: 1 });
  });
});

describe('commercial aggregation', () => {
  it('groups by currency, keeps one-time and monthly separate, never converts; accepted value follows the range', () => {
    const s = empty();
    s.companies = [company('cmp_p', 'awaiting_decision')];
    s.proposals = [
      proposal('prp_1', 'cmp_p', { items: [item('monthly', 2_500_000), item('one_time', 1_000_000, 2)] }),
      proposal('prp_2', 'cmp_p', { taxMode: 'included', items: [item('monthly', 500_000)] }),
      proposal('prp_3', 'cmp_p', { currency: 'USD', items: [item('one_time', 300_000)] }),
      proposal('prp_4', 'cmp_p', { currency: 'EUR', items: [] }),
      proposal('prp_5', 'cmp_p', { status: 'draft', sentAt: null, items: [item('monthly', 9_999_900)] }),
      proposal('prp_acc_in', 'cmp_p', { status: 'accepted', decidedAt: daysAgo(3), items: [item('monthly', 100_000)] }),
      proposal('prp_acc_out', 'cmp_p', { status: 'accepted', decidedAt: daysAgo(40), items: [item('monthly', 700_000)] }),
    ];
    const d = buildDashboard(s, NOW, '30d');
    expect(d.proposals.awaitingDecision).toEqual({
      proposals: 4,
      byCurrency: [
        { currency: 'TRY', oneTimeMinor: 2_000_000, monthlyMinor: 3_000_000, proposals: 2, taxMixed: true },
        { currency: 'USD', oneTimeMinor: 300_000, monthlyMinor: 0, proposals: 1, taxMixed: false },
      ],
    });
    expect(d.proposals.acceptedInRange).toEqual({ proposals: 1, byCurrency: [{ currency: 'TRY', oneTimeMinor: 0, monthlyMinor: 100_000, proposals: 1, taxMixed: false }] });
    expect(buildDashboard(s, NOW, '90d').proposals.acceptedInRange.proposals).toBe(2);
    expect(d.proposals.statusCounts).toMatchObject({ sent: 4, draft: 1, accepted: 2 });
  });
});

describe('range activity', () => {
  it('counts what happened in the window as plain numbers (no ratios)', () => {
    const s = empty();
    s.companies = [
      company('cmp_a', 'replied', { createdAt: daysAgo(5), history: [hist('Durum Bulundu → İlk Temas olarak değiştirildi', daysAgo(5)), hist('Durum İlk Temas → Yanıt Geldi olarak değiştirildi', daysAgo(2))] }),
      company('cmp_b', 'first_contact', { createdAt: daysAgo(50), history: [hist('Durum Bulundu → İlk Temas olarak değiştirildi', daysAgo(45))] }),
    ];
    s.sends = [{ id: 's1', companyId: 'cmp_a', status: 'sent', sentAt: daysAgo(5) } as OutboundMessage, { id: 's2', companyId: 'cmp_b', status: 'sent', sentAt: daysAgo(45) } as OutboundMessage, { id: 's3', companyId: 'cmp_a', status: 'failed', sentAt: null } as OutboundMessage];
    s.messages = [{ id: 'm1', companyId: 'cmp_a', direction: 'inbound', messageAt: daysAgo(2) } as ThreadMessage];
    const week = buildDashboard(s, NOW, '7d').sales.activity;
    expect(week).toMatchObject({ newCompanies: 1, sends: 1, replies: 1 });
    expect(week.stageEntries).toMatchObject({ first_contact: 1, replied: 1 });
    expect(buildDashboard(s, NOW, '90d').sales.activity).toMatchObject({ newCompanies: 2, sends: 2 });
    expect(JSON.stringify(buildDashboard(s, NOW, '30d'))).not.toMatch(/rate|percent|conversion/i);
  });
});
