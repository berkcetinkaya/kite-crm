// Phase 11: schema v6 (tasks), the v5 → v6 upgrade, and manual task behaviour (service + HTTP).
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskInput } from '../../src/domain/tasks';
import type { NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createApp } from '../app';
import { createClock } from '../clock';
import { loadConfig } from '../config';
import { createCustomerService } from '../customers/service';
import { MIGRATIONS, runMigrations } from '../db/migrations';
import { openDatabase, type Db } from '../db/sqlite';
import { createStore, openStore, type OpenedStore } from '../db/store';
import { createFollowUpPlanner } from '../followUp/service';
import { createGmailAdapter } from '../gmail/adapter';
import { createMemoryCredentialStore } from '../gmail/credentialStore';
import { createFixtureGmail, FIXTURE_AUTH_CODE } from '../gmail/fixture';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { createOutreachService } from '../outreach/service';
import { createPersistenceServices } from '../persistence/services';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createSalesService } from '../sales/service';
import { createTaskService, TaskError } from './service';

const stores: OpenedStore[] = [];
const dbs: Db[] = [];
const servers: http.Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  stores.splice(0).forEach((s) => {
    try {
      s.close();
    } catch {
      /* closed */
    }
  });
  dbs.splice(0).forEach((d) => {
    try {
      d.close();
    } catch {
      /* closed */
    }
  });
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const tmpFile = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kite-p11-'));
  dirs.push(d);
  return path.join(d, 'kite.db');
};

const BASE = Date.parse('2026-10-07T09:00:00.000Z');
const companyInput = (name: string, email: string, status: NewCompanyInput['status'] = 'researched'): NewCompanyInput => ({
  name,
  website: null,
  sector: 'Güzellik Markası',
  city: 'İstanbul',
  country: 'Türkiye',
  source: 'manual',
  opportunities: [{ service: 'meta_ads', score: null, potential: null, reason: '' }],
  opportunityScore: null,
  status,
  owner: 'Berk Çetinkaya',
  note: '',
  contacts: [{ fullName: 'Aytül', role: '', email, phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' }],
});
const task = (over: Partial<TaskInput> = {}): TaskInput => ({ title: 'Case study gönder', notes: '', priority: 'normal', dueAt: '2026-10-09T09:00:00.000Z', dueHasTime: false, owner: 'Berk Çetinkaya', companyId: null, customerId: null, ...over });

function setup(file = ':memory:') {
  const clock = createClock(0, () => BASE);
  const now = () => clock.now();
  const store = openStore(file);
  stores.push(store);
  const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
  const data = createPersistenceServices(store, { now, followUps: planner });
  const customers = createCustomerService(store, { now, followUps: planner });
  const tasks = createTaskService(store, { now });
  const company = data.companies.create(companyInput('Lyxa', 'a@lyxa.example', 'client'));
  return { clock, store, data, customers, tasks, company };
}

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TaskError);
    expect((e as TaskError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

const ALL_TABLES = (db: Db) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const snapshot = (db: Db, tables: string[]) => Object.fromEntries(tables.map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())]));

describe('schema v6', () => {
  it('a fresh installation reaches the latest schema with the tasks table (v6) and its two indexes', () => {
    const s = openStore(':memory:');
    stores.push(s);
    expect(s.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    const v6 = MIGRATIONS.find((m) => m.version === 6)!;
    expect(v6).toMatchObject({ version: 6, name: 'tasks' });
    expect(v6.foreignKeysOff).toBeUndefined();
    const idx = (s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND sql IS NOT NULL ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(idx).toEqual(['tasks_company', 'tasks_status_due']);
    const sql = v6.sql;
    for (const values of [TASK_STATUSES, TASK_PRIORITIES]) expect(sql).toContain(values.map((v) => `'${v}'`).join(','));
  });

  it('upgrades a Phase 10 database (sends, reply, follow-ups, meetings, proposals, customers) without changing any row', async () => {
    const file = tmpFile();
    const db = openDatabase(file);
    dbs.push(db);
    runMigrations(db, MIGRATIONS.filter((m) => m.version <= 5));
    const store = createStore(db);
    const clock = createClock(0, () => BASE);
    const now = () => clock.now();
    const fx = createFixtureGmail({ redirectUri: '/cb', now: () => clock.now().getTime() });
    const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials: createMemoryCredentialStore() });
    const { state } = gmail.beginAuthorization();
    await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
    const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
    const data = createPersistenceServices(store, { now, mailProvider: createFixtureMailProvider(), followUps: planner });
    const outreach = createOutreachService(store, gmail, { now, followUps: planner });
    const sales = createSalesService(store, { now, followUps: planner });
    const customers = createCustomerService(store, { now, followUps: planner });
    for (const [name, email] of [['Replied Co', 'a@replied.example'], ['Waiting Co', 'a@waiting.example']] as const) {
      const c = data.companies.create(companyInput(name, email));
      const d = await data.mail.generate({ companyId: c.id, service: 'meta_ads', language: 'tr', contactId: null, preserve: null });
      data.mail.approve(d.id, { selectedSubject: d.selectedSubject, body: d.body });
      await outreach.send({ draftId: d.id, companyId: c.id, contactId: c.contacts[0].id, idempotencyKey: `idem_p11_${name.replace(/\W/g, '')}_0001` });
    }
    const replied = store.outreach.listThreadSends().find((s) => s.recipientEmail === 'a@replied.example')!;
    fx.controls.addReply(replied.gmailThreadId!, { shape: 'reply' });
    await outreach.sync();
    sales.createMeeting(replied.companyId, { scheduledAt: '2026-10-08T10:00:00.000Z', type: 'online', contactId: null, notes: '', outcome: '', nextActionLabel: null, nextActionDueAt: null });
    const { proposal } = sales.createProposal(replied.companyId, { title: 'Paket', currency: 'TRY', contractMonths: 6, validUntil: null, notes: '', taxMode: 'excluded', taxRateBp: 2000, items: [{ service: 'meta_ads', description: '', billingType: 'monthly', unitAmountMinor: 2_500_000, quantity: 1 }] });
    sales.transitionProposal(proposal.id, { to: 'ready' });
    sales.transitionProposal(proposal.id, { to: 'sent', sentAt: '2026-10-07T09:00:00.000Z' });
    sales.transitionProposal(proposal.id, { to: 'accepted' });
    const client = data.companies.create(companyInput('Client Co', 'a@client.example', 'client'));
    customers.startOnboarding(client.id, { startDate: '2026-10-07T09:00:00.000Z', primaryContactId: null, commercialNotes: '', operationalNotes: '', sourceProposalId: null, services: [], onboardingItems: [{ label: 'Kickoff', templateKey: null, dueDate: null, notes: '' }], accessItems: [{ kind: 'ga4', label: '', notes: '' }], moveCompanyToClient: false });
    const tables = ALL_TABLES(db).filter((t) => t !== 'schema_migrations');
    expect(tables).toHaveLength(22);
    const before = snapshot(db, tables);
    expect(JSON.parse(before.customers)).toHaveLength(1);
    db.close();

    const s = openStore(file);
    stores.push(s);
    expect(s.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    expect(snapshot(s.db, tables)).toEqual(before);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 });
    expect(s.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(s.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(runMigrations(s.db)).toEqual({ applied: [], version: MIGRATIONS.at(-1)!.version });
  });

  it('the database refuses inconsistent task rows', () => {
    const t = setup();
    const raw = (sql: string, ...a: (string | number | null)[]) => () => t.store.db.prepare(sql).run(...a);
    const cols = 'id, title, status, created_at, updated_at';
    expect(raw(`INSERT INTO tasks (${cols}, closed_at) VALUES ('tsk_a', 'x', 'open', 'x', 'x', 'x')`)).toThrow(/CHECK/);
    expect(raw(`INSERT INTO tasks (${cols}) VALUES ('tsk_b', 'x', 'done', 'x', 'x')`)).toThrow(/CHECK/);
    expect(raw(`INSERT INTO tasks (${cols}) VALUES ('tsk_c', 'x', 'cancelled', 'x', 'x')`)).toThrow(/CHECK/);
    expect(raw(`INSERT INTO tasks (${cols}) VALUES ('tsk_d', '', 'open', 'x', 'x')`)).toThrow(/CHECK/);
    expect(raw(`INSERT INTO tasks (${cols}, due_has_time) VALUES ('tsk_e', 'x', 'open', 'x', 'x', 1)`)).toThrow(/CHECK/);
    expect(raw(`INSERT INTO tasks (${cols}, customer_id) VALUES ('tsk_f', 'x', 'open', 'x', 'x', 'cus_missing')`)).toThrow(/CHECK|FOREIGN KEY/);
    expect(raw(`INSERT INTO tasks (${cols}, company_id) VALUES ('tsk_g', 'x', 'open', 'x', 'x', 'cmp_missing')`)).toThrow(/FOREIGN KEY/);
  });
});

describe('manual tasks', () => {
  it('lifecycle: open → done → open → cancelled; closed_at follows the state', () => {
    const t = setup();
    const { task: created } = t.tasks.create(task({ title: '  Case study gönder  ', notes: ' Ece için ' }));
    expect(created).toMatchObject({ title: 'Case study gönder', notes: 'Ece için', status: 'open', closedAt: null, companyId: null, dueHasTime: false });
    t.clock.setOffsetMs(3_600_000);
    const done = t.tasks.changeStatus(created.id, 'done').task;
    expect(done).toMatchObject({ status: 'done', closedAt: '2026-10-07T10:00:00.000Z' });
    expect(t.tasks.changeStatus(created.id, 'open').task).toMatchObject({ status: 'open', closedAt: null });
    expect(t.tasks.changeStatus(created.id, 'cancelled').task).toMatchObject({ status: 'cancelled', closedAt: '2026-10-07T10:00:00.000Z' });
    expectCode(() => t.tasks.changeStatus(created.id, 'done'), 'task_invalid_transition');
    // Tamamlananlar lists only done tasks; cancelled ones are not completed.
    expect(t.store.tasks.listDoneSince('2026-01-01T00:00:00.000Z')).toEqual([]);
    expect(t.store.tasks.listOpen()).toEqual([]);
  });

  it('company history: one entry only when a company-linked task is marked Tamamlandı', () => {
    const t = setup();
    const h0 = t.store.companies.get(t.company.id)!.history.length;
    const { task: created } = t.tasks.create(task({ companyId: t.company.id }));
    t.tasks.update(created.id, task({ companyId: t.company.id, title: 'Yeni başlık', priority: 'high', dueAt: '2026-10-10T09:00:00.000Z' }));
    t.tasks.changeStatus(created.id, 'cancelled');
    t.tasks.changeStatus(created.id, 'open');
    expect(t.store.companies.get(t.company.id)!.history.length).toBe(h0);
    const r = t.tasks.changeStatus(created.id, 'done');
    expect(r.company!.history.length).toBe(h0 + 1);
    expect(r.company!.history[0]).toMatchObject({ type: 'task', description: 'Görev tamamlandı: Yeni başlık' });
    t.tasks.changeStatus(created.id, 'open');
    expect(t.store.companies.get(t.company.id)!.history.length).toBe(h0 + 1);
    expect(t.store.companies.get(t.company.id)!.lastContactAt).toBe(t.company.lastContactAt);
    // An unlinked task never touches any company.
    const free = t.tasks.create(task()).task;
    expect(t.tasks.changeStatus(free.id, 'done').company).toBeNull();
  });

  it('links: a customer task carries the customer company; mismatches and unknown ids are refused', () => {
    const t = setup();
    const other = t.data.companies.create(companyInput('Other', 'a@other.example'));
    const { customer } = t.customers.startOnboarding(t.company.id, { startDate: '2026-10-07T09:00:00.000Z', primaryContactId: null, commercialNotes: '', operationalNotes: '', sourceProposalId: null, services: [], onboardingItems: [], accessItems: [], moveCompanyToClient: false });
    expect(t.tasks.create(task({ customerId: customer.id })).task).toMatchObject({ companyId: t.company.id, customerId: customer.id });
    expectCode(() => t.tasks.create(task({ customerId: customer.id, companyId: other.id })), 'task_link_invalid');
    expectCode(() => t.tasks.create(task({ customerId: 'cus_missing_1' })), 'task_link_invalid');
    expectCode(() => t.tasks.create(task({ companyId: 'cmp_missing_1' })), 'task_link_invalid');
  });

  it('refuses credentials and empty titles; a time flag needs a due date', () => {
    const t = setup();
    expectCode(() => t.tasks.create(task({ notes: 'password: hunter2' })), 'task_secret');
    expectCode(() => t.tasks.create(task({ title: 'api key: abc' })), 'task_secret');
    expectCode(() => t.tasks.create(task({ title: '   ' })), 'task_invalid');
    expect(t.tasks.create(task({ dueAt: null, dueHasTime: true })).task).toMatchObject({ dueAt: null, dueHasTime: false });
    expect(t.tasks.create(task({ notes: 'Kampanya kimliği 23847562938475629384756' })).task.notes).toContain('2384');
  });

  it('survives a restart', () => {
    const file = tmpFile();
    const t = setup(file);
    const created = t.tasks.create(task({ companyId: t.company.id, dueHasTime: true, dueAt: '2026-10-08T11:30:00.000Z', priority: 'high' })).task;
    t.store.close();
    const again = openStore(file);
    stores.push(again);
    expect(again.tasks.get(created.id)).toEqual(created);
  });
});

describe('tasks HTTP', () => {
  it('creates, edits and closes through the API; refuses cross-site, bad input and unknown ids', async () => {
    const t = setup();
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, data: t.data, tasks: t.tasks, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (method: string, p: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

    expect((await send('POST', '/api/tasks', { task: task() }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send('POST', '/api/tasks', { task: { ...task(), priority: 'urgent' } })).status).toBe(400);
    const secret = await send('POST', '/api/tasks', { task: task({ notes: 'token: abc123' }) });
    expect(secret.status).toBe(400);
    expect(((await secret.json()) as { error: { message: string } }).error.message).toMatch(/Şifre, API key veya token saklamayın/);
    const created = await send('POST', '/api/tasks', { task: task({ companyId: t.company.id }) });
    expect(created.status).toBe(201);
    const { task: tk } = (await created.json()) as { task: { id: string } };
    expect((await send('PUT', `/api/tasks/${tk.id}`, { task: task({ companyId: t.company.id, title: 'Değişti' }) })).status).toBe(200);
    const list = (await (await fetch(`${base}/api/tasks?company=${t.company.id}`)).json()) as { tasks: { title: string }[] };
    expect(list.tasks.map((x) => x.title)).toEqual(['Değişti']);
    const done = await send('POST', `/api/tasks/${tk.id}/status`, { to: 'done' });
    expect(((await done.json()) as { company: { history: { type: string }[] } }).company.history[0].type).toBe('task');
    expect((await send('POST', `/api/tasks/${tk.id}/status`, { to: 'cancelled' })).status).toBe(409);
    expect((await send('POST', '/api/tasks/tsk_missing_1/status', { to: 'done' })).status).toBe(404);
    expect((await fetch(`${base}/api/tasks`)).status).toBe(400);
  });
});
