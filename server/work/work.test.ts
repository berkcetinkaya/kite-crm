// Phase 11: shared work-item derivation (one adapter per source), the Bugün projection and the
// read-only /api/work endpoint.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { dueBucket } from '../../src/domain/businessDay';
import type { Company } from '../../src/domain/company';
import type { Customer } from '../../src/domain/customers';
import type { FollowUpSequenceView } from '../../src/domain/followUp';
import type { Meeting, Proposal } from '../../src/domain/sales';
import type { SalesStatus } from '../../src/domain/salesStatus';
import type { Task } from '../../src/domain/tasks';
import { inView, type WorkItem, type WorkResponse } from '../../src/domain/work';
import type { NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createApp } from '../app';
import { createClock } from '../clock';
import { loadConfig } from '../config';
import { createCustomerService } from '../customers/service';
import { openStore, type OpenedStore } from '../db/store';
import { createFollowUpPlanner } from '../followUp/service';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { createPersistenceServices } from '../persistence/services';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createSalesService } from '../sales/service';
import { createTaskService } from '../tasks/service';
import { attentionFromWork, collectWorkItems, deriveWorkItems, type WorkSnapshot } from './derive';
import { createWorkService } from './service';

const NOW = '2026-10-20T09:00:00.000Z'; // 12:00 İstanbul
const ago = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const company = (id: string, status: SalesStatus, over: Partial<Company> = {}): Company =>
  ({ id, name: id.replace('cmp_', ''), status, owner: 'Berk Çetinkaya', history: [], lastContactAt: null, nextAction: null, createdAt: ago(60), contacts: [], notes: [], opportunities: [], ...over }) as unknown as Company;
const tsk = (id: string, over: Partial<Task> = {}): Task => ({ id, title: `Görev ${id}`, notes: '', status: 'open', priority: 'normal', dueAt: null, dueHasTime: false, owner: 'Berk Çetinkaya', companyId: null, customerId: null, createdAt: ago(5), updatedAt: ago(5), closedAt: null, ...over });
const customer = (id: string, companyId: string, over: Partial<Customer> = {}): Customer => ({
  id, companyId, status: 'onboarding', startDate: ago(5), endDate: null, primaryContactId: null, primaryContactName: null, primaryContactEmail: null, sourceProposalId: null, commercialNotes: '', operationalNotes: '', onboardingStartedAt: ago(5), onboardingCompletedAt: null, createdAt: ago(5), updatedAt: ago(5), services: [], onboarding: [], access: [], ...over,
});
const onb = (id: string, customerId: string, label: string, dueDate: string | null, status: Customer['onboarding'][number]['status'] = 'pending', position = 0) => ({ id, customerId, position, label, status, notes: '', dueDate, completedAt: status === 'done' ? NOW : null, templateKey: null, createdAt: NOW, updatedAt: NOW });
const acc = (id: string, customerId: string, status: Customer['access'][number]['status'], label = 'GA4 erişimi') => ({ id, customerId, position: 0, kind: 'ga4' as const, label, status, requestedAt: status === 'not_requested' ? null : ago(4), receivedAt: status === 'received' ? ago(1) : null, notes: '', createdAt: ago(6), updatedAt: ago(2) });
const empty = (): WorkSnapshot => ({ companies: [], followUps: [], meetings: [], proposals: [], customers: [], tasks: [] });
const keys = (items: WorkItem[]) => items.map((i) => `${i.key}|${i.kind}|${i.bucket}|${i.severity}`);

describe('due buckets (shared İstanbul day)', () => {
  it('classifies overdue / today / upcoming (7 days) / later / undated', () => {
    expect(dueBucket(null, NOW)).toBe('undated');
    expect(dueBucket('2026-10-19T20:59:00.000Z', NOW)).toBe('overdue'); // 19 Oct 23:59 İstanbul
    expect(dueBucket('2026-10-19T21:00:00.000Z', NOW)).toBe('today'); // 20 Oct 00:00 İstanbul
    expect(dueBucket('2026-10-27T09:00:00.000Z', NOW)).toBe('upcoming');
    expect(dueBucket('2026-10-28T09:00:00.000Z', NOW)).toBe('later');
  });
});

describe('source adapters', () => {
  it('manual tasks: only open ones; overdue > 3 days or high priority is critical; today is Bugün; others are İşler only', () => {
    const s = empty();
    s.tasks = [
      tsk('tsk_late', { dueAt: ago(4) }),
      tsk('tsk_late_high', { dueAt: ago(1), priority: 'high' }),
      tsk('tsk_late_normal', { dueAt: ago(2) }),
      tsk('tsk_today', { dueAt: '2026-10-20T15:00:00.000Z', dueHasTime: true }),
      tsk('tsk_soon', { dueAt: ago(-3) }),
      tsk('tsk_none'),
      tsk('tsk_done', { status: 'done', closedAt: ago(1), dueAt: ago(9) }),
    ];
    const items = deriveWorkItems(s, NOW);
    expect(keys(items)).toEqual([
      'task:tsk_late|task|overdue|1',
      'task:tsk_late_high|task|overdue|1',
      'task:tsk_late_normal|task|overdue|2',
      'task:tsk_today|task|today|2',
      'task:tsk_soon|task|upcoming|null',
      'task:tsk_none|task|undated|null',
    ]);
    expect(items[0]).toMatchObject({ source: 'task', group: 'manual', ageDays: 4, link: { type: 'task', taskId: 'tsk_late' }, companyName: null });
    expect(items[0].actions.map((a) => a.type)).toEqual(['task_status', 'task_edit', 'task_status']);
  });

  it('access: Sorun Var is critical; İstendi and İstenmedi are İşler only; Alındı and finished customers yield nothing', () => {
    const s = empty();
    s.companies = [company('cmp_c', 'client'), company('cmp_done', 'client')];
    s.customers = [
      customer('cus_1', 'cmp_c', { access: [acc('acc_p', 'cus_1', 'problem', 'Meta BM'), acc('acc_r', 'cus_1', 'requested'), acc('acc_n', 'cus_1', 'not_requested', 'Search Console'), acc('acc_ok', 'cus_1', 'received')] }),
      customer('cus_2', 'cmp_done', { status: 'completed', access: [acc('acc_x', 'cus_2', 'problem')] }),
    ];
    const items = deriveWorkItems(s, NOW);
    expect(keys(items)).toEqual(['access:acc_p|access_problem|undated|1', 'access:acc_r|access_requested|undated|null', 'access:acc_n|access_not_requested|undated|null']);
    expect(items[1]).toMatchObject({ ageDays: 4, actions: [{ type: 'access_status' }], ref: { accessId: 'acc_r', status: 'requested' } });
    const attention = attentionFromWork(collectWorkItems(s, NOW));
    expect(attention.map((a) => a.key)).toEqual(['access:acc_p']);
    expect(items.filter((i) => inView(i, 'all'))).toHaveLength(3);
    expect(items.filter((i) => inView(i, 'today')).map((i) => i.key)).toEqual(['access:acc_p']);
  });

  it('onboarding: individual rows on İşler; grouped per customer (checklist order) on Bugün', () => {
    const s = empty();
    s.companies = [company('cmp_c', 'client')];
    s.customers = [
      customer('cus_1', 'cmp_c', {
        onboarding: [
          onb('onb_a', 'cus_1', 'Kickoff', ago(1), 'pending', 0),
          onb('onb_b', 'cus_1', 'Marka', ago(5), 'in_progress', 1),
          onb('onb_c', 'cus_1', 'Rapor', '2026-10-20T09:00:00.000Z', 'pending', 2),
          onb('onb_d', 'cus_1', 'Logo', null, 'pending', 3),
          onb('onb_e', 'cus_1', 'Bitti', ago(9), 'done', 4),
          onb('onb_f', 'cus_1', 'Gereksiz', ago(9), 'not_needed', 5),
        ],
      }),
    ];
    const items = deriveWorkItems(s, NOW);
    expect(keys(items)).toEqual(['onb:onb_b|onboarding_overdue|overdue|1', 'onb:onb_a|onboarding_overdue|overdue|1', 'onb:onb_c|onboarding_today|today|2', 'onb:onb_d|onboarding_open|undated|null']);
    expect(items[0]).toMatchObject({ title: 'Marka', actions: [{ type: 'onboarding_status' }], ref: { onboardingItemId: 'onb_b', status: 'in_progress' } });
    const attention = attentionFromWork(collectWorkItems(s, NOW));
    expect(attention.map((a) => [a.key, a.kind, a.severity, a.description, a.ageDays])).toEqual([
      ['onboarding:cus_1', 'onboarding_overdue', 1, '2 gecikmiş adım: Kickoff, Marka', 5],
      ['onboarding-today:cus_1', 'onboarding_today', 2, '1 adımın son günü bugün: Rapor', 0],
    ]);
  });

  it('follow-ups: due and blocked reach Bugün; prepared / approved / upcoming are İşler only; finished yields nothing', () => {
    const s = empty();
    s.companies = [company('cmp_f', 'first_contact')];
    const seq = (id: string, queueGroup: FollowUpSequenceView['queueGroup'], dueAt = ago(1), extra: Partial<FollowUpSequenceView> = {}) =>
      ({ id, companyId: 'cmp_f', status: 'active', queueGroup, blockers: [], steps: [{ id: `${id}_s`, stepNumber: 2, status: 'scheduled', dueAt }], ...extra }) as unknown as FollowUpSequenceView;
    s.followUps = [seq('fus_due', 'due'), seq('fus_block', 'attention', ago(1), { blockers: ['Alıcı adresi yok'] }), seq('fus_prep', 'prepared', ago(2)), seq('fus_up', 'upcoming', ago(-2)), seq('fus_fin', 'finished')];
    const items = deriveWorkItems(s, NOW);
    expect(keys(items)).toEqual(['follow-up:fus_due|follow_up_due|overdue|2', 'follow-up:fus_block|follow_up_blocked|undated|2', 'follow-up:fus_prep|follow_up_waiting|overdue|null', 'follow-up:fus_up|follow_up_upcoming|upcoming|null']);
    expect(items.every((i) => i.actions.length === 0 && i.link.type === 'mail')).toBe(true);
  });

  it('meetings, next actions, proposals and customers keep the Phase 10 rules; only next actions get inline actions', () => {
    const s = empty();
    s.companies = [
      company('cmp_a', 'meeting', { nextAction: { label: 'Ara', dueAt: ago(4) } }),
      company('cmp_b', 'replied', { nextAction: { label: 'Mail', dueAt: ago(-10) } }),
      company('cmp_lost', 'lost', { nextAction: { label: 'Yok', dueAt: ago(9) } }),
      company('cmp_c', 'client'),
    ];
    const meet = (id: string, at: string): Meeting => ({ id, companyId: 'cmp_a', scheduledAt: at, type: 'online', status: 'planned', contactId: null, contactName: null, contactEmail: null, notes: '', outcome: '', nextActionLabel: 'Kopya', nextActionDueAt: ago(1), completedAt: null, createdAt: ago(3), updatedAt: ago(3) });
    s.meetings = [meet('mtg_past', ago(1)), meet('mtg_today', '2026-10-20T14:00:00.000Z'), meet('mtg_next', ago(-3))];
    const prop = (id: string, over: Partial<Proposal>): Proposal => ({ id, companyId: 'cmp_a', title: id, currency: 'TRY', contractMonths: null, validUntil: null, notes: '', taxMode: 'excluded', taxRateBp: null, status: 'sent', sentAt: ago(3), decidedAt: null, lossReason: null, createdAt: ago(9), updatedAt: ago(3), items: [], ...over });
    s.proposals = [prop('prp_fresh', {}), prop('prp_wait', { sentAt: ago(8) }), prop('prp_exp', { sentAt: ago(2), validUntil: ago(1) })];
    s.customers = [customer('cus_a', 'cmp_c', { status: 'active' })];
    const items = deriveWorkItems(s, NOW);
    expect(keys(items)).toEqual([
      'next:cmp_a|next_action_overdue|overdue|1',
      'proposal:prp_exp|proposal_waiting|overdue|1',
      'proposal:prp_wait|proposal_waiting|overdue|2',
      'meeting:mtg_past|meeting_no_outcome|overdue|2',
      'meeting:mtg_today|meeting_today|today|3',
      'customer-next:cus_a|customer_no_next_action|undated|3',
      'meeting:mtg_next|meeting_upcoming|upcoming|null',
      'proposal:prp_fresh|proposal_sent|upcoming|null',
      'next:cmp_b|next_action|later|null',
    ]);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey['next:cmp_a'].actions.map((a) => a.type)).toEqual(['next_action_clear', 'next_action_edit']);
    expect(byKey['customer-next:cus_a'].actions.map((a) => a.type)).toEqual(['next_action_set']);
    for (const k of ['meeting:mtg_past', 'meeting:mtg_today', 'proposal:prp_wait', 'proposal:prp_exp']) expect(byKey[k].actions).toEqual([]);
    // A meeting's own next-action fields are never a separate item.
    expect(items.filter((i) => i.title === 'Kopya')).toEqual([]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it('Bugün ⊆ İşler "Bugün" view; views partition by bucket', () => {
    const s = empty();
    s.companies = [company('cmp_a', 'meeting', { nextAction: { label: 'Ara', dueAt: ago(0) } })];
    s.tasks = [tsk('tsk_1', { dueAt: ago(2) }), tsk('tsk_2', { dueAt: ago(-2) }), tsk('tsk_3')];
    const items = deriveWorkItems(s, NOW);
    const attentionKeys = attentionFromWork(collectWorkItems(s, NOW)).map((a) => a.key);
    const todayKeys = items.filter((i) => inView(i, 'today')).map((i) => i.key);
    expect(attentionKeys.every((k) => todayKeys.includes(k))).toBe(true);
    expect(items.filter((i) => inView(i, 'overdue')).map((i) => i.key)).toEqual(['task:tsk_1']);
    expect(items.filter((i) => inView(i, 'upcoming')).map((i) => i.key)).toEqual(['task:tsk_2']);
    expect(attentionFromWork(collectWorkItems(s, NOW)).map((a) => [a.kind, a.description, a.companyName])).toEqual([
      ['task_overdue', 'Görev tsk_1', ''],
      ['next_action_today', 'Ara', 'a'],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------

const stores: OpenedStore[] = [];
const servers: http.Server[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  stores.splice(0).forEach((s) => s.close());
});

const companyInput = (name: string, status: NewCompanyInput['status']): NewCompanyInput => ({
  name, website: null, sector: 'Diş Kliniği', city: 'İzmir', country: 'Türkiye', source: 'manual', opportunities: [{ service: 'crm', score: null, potential: null, reason: '' }], opportunityScore: null, status, owner: 'Berk Çetinkaya', note: '',
  contacts: [{ fullName: 'Ece', role: '', email: `${name.toLowerCase().replace(/\W/g, '')}@x.example`, phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' }],
});

describe('GET /api/work', () => {
  it('lists every open item and recent completed tasks, and is strictly read-only', async () => {
    const clock = createClock(0, () => Date.parse('2026-10-07T09:00:00.000Z'));
    const now = () => clock.now();
    const store = openStore(':memory:');
    stores.push(store);
    const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
    const data = createPersistenceServices(store, { now, followUps: planner });
    const sales = createSalesService(store, { now, followUps: planner });
    const customers = createCustomerService(store, { now, followUps: planner });
    const tasks = createTaskService(store, { now });
    const a = data.companies.create(companyInput('Alfa', 'meeting'));
    const client = data.companies.create(companyInput('Client', 'client'));
    sales.createMeeting(a.id, { scheduledAt: '2026-10-06T10:00:00.000Z', type: 'online', contactId: null, notes: '', outcome: '', nextActionLabel: null, nextActionDueAt: null });
    customers.startOnboarding(client.id, { startDate: '2026-10-07T09:00:00.000Z', primaryContactId: null, commercialNotes: '', operationalNotes: '', sourceProposalId: null, services: [], onboardingItems: [{ label: 'Kickoff', templateKey: null, dueDate: '2026-10-05T09:00:00.000Z', notes: '' }], accessItems: [{ kind: 'ga4', label: '', notes: '' }], moveCompanyToClient: false });
    const open = tasks.create({ title: 'Teklif revizyonu', notes: '', priority: 'high', dueAt: '2026-10-07T12:00:00.000Z', dueHasTime: false, owner: null, companyId: a.id, customerId: null }).task;
    const done = tasks.create({ title: 'Eski iş', notes: '', priority: 'normal', dueAt: null, dueHasTime: false, owner: null, companyId: null, customerId: null }).task;
    tasks.changeStatus(done.id, 'done');
    const cancelled = tasks.create({ title: 'Vazgeçildi', notes: '', priority: 'low', dueAt: null, dueHasTime: false, owner: null, companyId: null, customerId: null }).task;
    tasks.changeStatus(cancelled.id, 'cancelled');

    const work = createWorkService(store, { now, followUps: planner });
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, data, work, tasks, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fingerprint = () => JSON.stringify((store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => store.db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()));
    const before = fingerprint();
    let body: WorkResponse | null = null;
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/api/work?completed=${i % 2 ? 90 : 30}`);
      expect(r.status).toBe(200);
      body = (await r.json()) as WorkResponse;
    }
    expect(fingerprint()).toBe(before);
    expect(body!.items.map((i) => `${i.source}:${i.kind}`)).toEqual(['onboarding:onboarding_overdue', 'meeting:meeting_no_outcome', 'task:task', 'access:access_not_requested']);
    expect(body!.items.find((i) => i.source === 'task')).toMatchObject({ ref: { taskId: open.id }, companyName: 'Alfa', severity: 2, priority: 'high' });
    expect(body!.completed.map((t) => t.title)).toEqual(['Eski iş']);
    expect((await fetch(`${base}/api/work?completed=7`)).status).toBe(400);
    expect((await fetch(`${base}/api/work`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(405);
  });
});
