// Finance (schema v9): the v8 → v9 upgrade, KITE Finans and Berk services, separation between them,
// currency handling, secret refusal, restart persistence and the HTTP layer.
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FinanceEntryInput, KiteFinanceEntryInput, PersonalDebtInput } from '../../src/domain/finance';
import { debtRemaining, FINANCE_CURRENCIES, FINANCE_DIRECTIONS, FINANCE_STATUSES, monthSummary, openPosition, RECURRENCES } from '../../src/domain/finance';
import type { NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createApp } from '../app';
import { createClock } from '../clock';
import { loadConfig } from '../config';
import { MIGRATIONS, runMigrations } from '../db/migrations';
import { openDatabase, type Db } from '../db/sqlite';
import { createStore, openStore, type OpenedStore } from '../db/store';
import { asSchemaVersion, seedFirstContactDraft } from '../db/testFixtures';
import { createFollowUpPlanner } from '../followUp/service';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { createPersistenceServices } from '../persistence/services';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createTaskService } from '../tasks/service';
import { createKiteFinanceService, createPersonalFinanceService, FinanceError } from './service';

const BASE = Date.parse('2026-10-09T09:00:00.000Z');
const stores: OpenedStore[] = [];
const dbs: Db[] = [];
const servers: http.Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  for (const s of stores.splice(0))
    try {
      s.close();
    } catch {
      /* closed */
    }
  for (const d of dbs.splice(0))
    try {
      d.close();
    } catch {
      /* closed */
    }
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const tmpFile = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kite-fin-'));
  dirs.push(d);
  return path.join(d, 'kite.db');
};

const companyInput = (name: string): NewCompanyInput => ({
  name,
  website: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example`,
  sector: 'Turizm',
  city: 'İstanbul',
  country: 'Türkiye',
  source: 'manual',
  opportunities: [{ service: 'crm', score: 70, potential: 'high', reason: '' }],
  opportunityScore: 70,
  status: 'client',
  owner: 'Berk Çetinkaya',
  note: '',
});
const kiteEntry = (over: Partial<KiteFinanceEntryInput> = {}): KiteFinanceEntryInput => ({
  kind: 'income',
  title: 'Aylık yönetim ücreti',
  notes: '',
  counterparty: '',
  amountMinor: 50_000,
  currency: 'USD',
  category: 'client_payment',
  date: '2026-10-05',
  dueDate: null,
  paidOn: null,
  recurrence: 'none',
  companyId: null,
  customerId: null,
  ...over,
});
const personalEntry = (over: Partial<FinanceEntryInput> = {}): FinanceEntryInput => ({
  kind: 'expense',
  title: 'Market',
  notes: '',
  counterparty: '',
  amountMinor: 250_000,
  currency: 'TRY',
  category: 'groceries',
  date: '2026-10-03',
  dueDate: null,
  paidOn: null,
  recurrence: 'none',
  ...over,
});
const debtInput = (over: Partial<PersonalDebtInput> = {}): PersonalDebtInput => ({
  creditor: 'Yasemin',
  notes: '',
  currency: 'TRY',
  principalMinor: 12_000_000,
  startDate: '2026-09-01',
  nextDueDate: '2026-10-15',
  installmentMinor: 2_000_000,
  ...over,
});

function setup(file = ':memory:') {
  const clock = createClock(0, () => BASE);
  const now = () => clock.now();
  const store = openStore(file);
  stores.push(store);
  const data = createPersistenceServices(store, { now, mailProvider: createFixtureMailProvider(), followUps: createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() }) });
  const kite = createKiteFinanceService(store, { now });
  const personal = createPersonalFinanceService(store, { now });
  return { store, clock, data, kite, personal };
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FinanceError);
    expect((e as FinanceError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

const tables = (db: Db) => (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const fingerprint = (db: Db, names: string[]) => Object.fromEntries(names.map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())]));
const FINANCE_TABLES = ['kite_finance_entries', 'personal_budgets', 'personal_debt_payments', 'personal_debts', 'personal_finance_entries'];
const count = (db: Db, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;

describe('schema v9', () => {
  it('is the latest migration: additive, five finance tables, literal enumerations match the domain', () => {
    const v9 = MIGRATIONS.at(-1)!;
    expect(v9).toMatchObject({ version: 9, name: 'finance' });
    expect(v9.foreignKeysOff).toBeUndefined();
    expect(v9.sql.replace(/ON DELETE (SET NULL|CASCADE)/g, '')).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE|INSERT)\b/i);
    const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');
    for (const values of [FINANCE_CURRENCIES, FINANCE_DIRECTIONS, FINANCE_STATUSES, RECURRENCES]) expect(v9.sql).toContain(list(values));
    const s = openStore(':memory:');
    stores.push(s);
    expect(s.schemaVersion).toBe(9);
    expect(tables(s.db)).toEqual(expect.arrayContaining(FINANCE_TABLES));
    for (const t of FINANCE_TABLES) expect(count(s.db, t)).toBe(0);
  });

  it('upgrades a populated v8 database: every v8 table byte-identical, finance tables empty, integrity and FKs clean', () => {
    const file = tmpFile();
    const db = openDatabase(file);
    dbs.push(db);
    runMigrations(db, MIGRATIONS.filter((m) => m.version <= 8));
    const store = asSchemaVersion(createStore(db), 8);
    const clock = createClock(0, () => BASE);
    const now = () => clock.now();
    const data = createPersistenceServices(store, { now, mailProvider: createFixtureMailProvider(), followUps: createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() }) });
    const c = data.companies.create(companyInput('Ecru Atelier'));
    data.companies.addContact(c.id, { fullName: 'Ece', role: '', email: 'ece@ecru.example', phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' });
    seedFirstContactDraft(store, c.id, { at: now().toISOString() });
    createTaskService(store, { now }).create({ title: 'Ara', notes: '', priority: 'normal', dueAt: null, dueHasTime: false, owner: null, companyId: c.id, customerId: null });
    const v8Tables = tables(db);
    const before = fingerprint(db, v8Tables);
    db.close();

    const s = openStore(file);
    stores.push(s);
    expect(s.schemaVersion).toBe(9);
    expect(fingerprint(s.db, v8Tables.filter((t) => t !== 'schema_migrations'))).toEqual(Object.fromEntries(Object.entries(before).filter(([t]) => t !== 'schema_migrations')));
    expect(count(s.db, 'schema_migrations')).toBe(9);
    expect(tables(s.db).filter((t) => !v8Tables.includes(t)).sort()).toEqual(FINANCE_TABLES);
    for (const t of FINANCE_TABLES) expect(count(s.db, t)).toBe(0);
    expect(s.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(s.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(runMigrations(s.db)).toEqual({ applied: [], version: 9 });
  });
});

describe('KITE Finans', () => {
  it('income and expense are recorded as paid on their date; amounts stay per currency', () => {
    const t = setup();
    const inc = t.kite.create(kiteEntry({ amountMinor: 4_200_000, currency: 'TRY' }));
    expect(inc).toMatchObject({ direction: 'income', status: 'paid', paidOn: '2026-10-05', paidAt: '2026-10-09T09:00:00.000Z', seriesId: inc.id, companyId: null });
    t.kite.create(kiteEntry({ amountMinor: 85_000, currency: 'USD' }));
    t.kite.create(kiteEntry({ kind: 'expense', title: 'Figma', category: 'software', amountMinor: 1_500, currency: 'USD' }));
    t.kite.create(kiteEntry({ kind: 'income', title: 'Bali projesi', amountMinor: 650_000_000, currency: 'IDR' }));
    const s = monthSummary(t.kite.list().entries, '2026-10');
    expect(s.income).toEqual([
      { currency: 'TRY', amountMinor: 4_200_000 },
      { currency: 'USD', amountMinor: 85_000 },
      { currency: 'IDR', amountMinor: 650_000_000 },
    ]);
    expect(s.expense).toEqual([{ currency: 'USD', amountMinor: 1_500 }]);
    expect(s.receivable).toEqual([]);
  });

  it('a pending receivable keeps its due date when paid, and moves from pending to income (same row)', () => {
    const t = setup();
    const r = t.kite.create(kiteEntry({ kind: 'receivable', title: 'DeseTour', counterparty: 'DeseTour', date: '2026-10-01', dueDate: '2026-10-15' }));
    expect(r).toMatchObject({ status: 'pending', paidOn: null, paidAt: null });
    expect(openPosition(t.kite.list().entries, '2026-10-09').receivable).toEqual([{ currency: 'USD', amountMinor: 50_000 }]);
    expect(monthSummary(t.kite.list().entries, '2026-10').receivable).toEqual([{ currency: 'USD', amountMinor: 50_000 }]);
    const paid = t.kite.changeStatus(r.id, 'paid', '2026-10-16');
    expect(paid).toMatchObject({ id: r.id, status: 'paid', dueDate: '2026-10-15', paidOn: '2026-10-16', paidAt: '2026-10-09T09:00:00.000Z' });
    expect(t.kite.list().entries).toHaveLength(1);
    const s = monthSummary(t.kite.list().entries, '2026-10');
    expect(s.receivable).toEqual([]);
    expect(s.income).toEqual([{ currency: 'USD', amountMinor: 50_000 }]);
    expect(openPosition(t.kite.list().entries, '2026-10-09').receivable).toEqual([]);
    // Undo and cancel follow explicit transitions.
    expect(t.kite.changeStatus(r.id, 'pending', null)).toMatchObject({ status: 'pending', paidOn: null, paidAt: null, dueDate: '2026-10-15' });
    expect(t.kite.changeStatus(r.id, 'cancelled', null)).toMatchObject({ status: 'cancelled', cancelledAt: expect.any(String) });
    expectCode(() => t.kite.changeStatus(r.id, 'paid', null), 'finance_invalid_transition');
    expectCode(() => t.kite.update(r.id, kiteEntry()), 'finance_invalid_transition');
  });

  it('recurring items carry metadata and create exactly one next occurrence on request', () => {
    const t = setup();
    const hosting = t.kite.create(kiteEntry({ kind: 'payable', title: 'Hosting', category: 'hosting', amountMinor: 2_000, date: '2026-10-31', dueDate: '2026-10-31', recurrence: 'monthly' }));
    expect(hosting).toMatchObject({ recurrence: 'monthly', seriesId: hosting.id });
    const next = t.kite.createNext(hosting.id);
    expect(next).toMatchObject({ seriesId: hosting.id, date: '2026-11-30', dueDate: '2026-11-30', status: 'pending', recurrence: 'monthly', title: 'Hosting' });
    expect(next.id).not.toBe(hosting.id);
    expectCode(() => t.kite.createNext(hosting.id), 'finance_recurrence');
    const yearly = t.kite.create(kiteEntry({ kind: 'expense', title: 'Domain', category: 'hosting', recurrence: 'yearly', date: '2026-02-28' }));
    expect(t.kite.createNext(yearly.id)).toMatchObject({ date: '2027-02-28', status: 'pending', paidOn: null });
    const once = t.kite.create(kiteEntry());
    expectCode(() => t.kite.createNext(once.id), 'finance_recurrence');
  });

  it('links to a company or customer (customer brings its company), reads CRM but never writes it', () => {
    const t = setup();
    const c = t.data.companies.create(companyInput('Ecru Atelier'));
    const customer = { id: 'cus_ecru', companyId: c.id };
    t.store.db.prepare(`INSERT INTO customers (id, company_id, status, start_date, onboarding_started_at, created_at, updated_at) VALUES (?, ?, 'active', '2026-10-01', ?, ?, ?)`).run(customer.id, c.id, '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z');
    const crmBefore = fingerprint(t.store.db, ['companies', 'company_history', 'customers']);
    expect(t.kite.create(kiteEntry({ companyId: c.id }))).toMatchObject({ companyId: c.id, customerId: null });
    expect(t.kite.create(kiteEntry({ customerId: customer.id }))).toMatchObject({ companyId: c.id, customerId: customer.id });
    expectCode(() => t.kite.create(kiteEntry({ companyId: 'cmp_missing' })), 'finance_link_invalid');
    expectCode(() => t.kite.create(kiteEntry({ companyId: 'cmp_other', customerId: customer.id })), 'finance_link_invalid');
    expect(fingerprint(t.store.db, ['companies', 'company_history', 'customers'])).toEqual(crmBefore);
  });

  it('validates input and refuses credentials, card numbers, PINs and seed phrases', () => {
    const t = setup();
    expectCode(() => t.kite.create(kiteEntry({ amountMinor: 0 })), 'finance_invalid');
    expectCode(() => t.kite.create(kiteEntry({ category: 'rent' })), 'finance_invalid');
    expectCode(() => t.kite.create(kiteEntry({ date: '2026-02-30' })), 'finance_invalid');
    expectCode(() => t.kite.create(kiteEntry({ title: '  ' })), 'finance_invalid');
    for (const notes of ['password: hunter2', 'Kart 4111 1111 1111 1111', 'PIN: 1234', 'seed phrase abandon ability', 'api_key=sk-12345678', 'CVV 123'])
      expectCode(() => t.kite.create(kiteEntry({ notes })), 'finance_secret');
    expect(t.kite.create(kiteEntry({ notes: 'Fatura no 2026-104, 3 taksit' })).notes).toBe('Fatura no 2026-104, 3 taksit');
    expect(t.kite.list().entries).toHaveLength(1);
  });
});

describe('Berk', () => {
  it('personal income and spending; KITE and Berk never see each other', () => {
    const t = setup();
    t.personal.createEntry(personalEntry());
    t.personal.createEntry(personalEntry({ kind: 'income', title: 'KITE maaşı', category: 'earnings', amountMinor: 6_000_000 }));
    t.kite.create(kiteEntry());
    expect(t.personal.list().entries.map((e) => e.title).sort()).toEqual(['KITE maaşı', 'Market']);
    expect(t.kite.list().entries.map((e) => e.title)).toEqual(['Aylık yönetim ücreti']);
    expect(count(t.store.db, 'kite_finance_entries')).toBe(1);
    expect(count(t.store.db, 'personal_finance_entries')).toBe(2);
    const s = monthSummary(t.personal.list().entries, '2026-10');
    expect(s).toMatchObject({ income: [{ currency: 'TRY', amountMinor: 6_000_000 }], expense: [{ currency: 'TRY', amountMinor: 250_000 }] });
    // Ids of one side are unknown to the other.
    const k = t.kite.list().entries[0];
    expectCode(() => t.personal.changeEntryStatus(k.id, 'cancelled', null), 'finance_not_found');
    expectCode(() => t.personal.createEntry(personalEntry({ category: 'client_payment' })), 'finance_invalid');
  });

  it('debt: create, two repayments, remaining balance, overpayment refused, closes at zero, reopens on removal', () => {
    const t = setup();
    const d = t.personal.createDebt(debtInput());
    expect(d).toMatchObject({ creditor: 'Yasemin', principalMinor: 12_000_000, payments: [], closedAt: null });
    let after = t.personal.addPayment(d.id, { amountMinor: 2_000_000, paidOn: '2026-09-15', notes: '', nextDueDate: '2026-11-15' });
    after = t.personal.addPayment(d.id, { amountMinor: 2_000_000, paidOn: '2026-10-15', notes: '' });
    expect(after.payments.map((p) => p.amountMinor)).toEqual([2_000_000, 2_000_000]);
    expect(debtRemaining(after)).toBe(8_000_000);
    expect(after.nextDueDate).toBe('2026-11-15');
    expectCode(() => t.personal.addPayment(d.id, { amountMinor: 8_000_001, paidOn: '2026-10-20', notes: '' }), 'debt_overpayment');
    expect(() => t.personal.updateDebt(d.id, debtInput({ principalMinor: 3_000_000 }))).toThrow(FinanceError);
    expectCode(() => t.personal.updateDebt(d.id, debtInput({ currency: 'USD' })), 'finance_invalid');
    const closed = t.personal.addPayment(d.id, { amountMinor: 8_000_000, paidOn: '2026-10-20', notes: '' });
    expect(debtRemaining(closed)).toBe(0);
    expect(closed).toMatchObject({ closedAt: '2026-10-09T09:00:00.000Z', nextDueDate: null });
    const reopened = t.personal.deletePayment(d.id, closed.payments.at(-1)!.id);
    expect(debtRemaining(reopened)).toBe(8_000_000);
    expect(reopened.closedAt).toBeNull();
    // Repayments never become spending rows.
    expect(t.personal.list().entries).toEqual([]);
    t.personal.deleteDebt(d.id);
    expect(count(t.store.db, 'personal_debt_payments')).toBe(0);
  });

  it('recurring commitments and monthly budgets per currency', () => {
    const t = setup();
    const rent = t.personal.createEntry(personalEntry({ title: 'Kira', category: 'rent', amountMinor: 2_500_000, recurrence: 'monthly' }));
    t.personal.createNextEntry(rent.id);
    expect(t.personal.list().entries.filter((e) => e.seriesId === rent.id)).toHaveLength(2);
    t.personal.createEntry(personalEntry({ title: 'Motor sigortası', category: 'motorcycle', amountMinor: 900_000, recurrence: 'yearly' }));
    t.personal.createEntry(personalEntry({ title: 'Villa', category: 'rent', amountMinor: 1_000_000_000, currency: 'IDR', recurrence: 'monthly' }));
    expect(t.personal.setBudget('TRY', 4_000_000)).toEqual([{ currency: 'TRY', monthlyLimitMinor: 4_000_000, updatedAt: '2026-10-09T09:00:00.000Z' }]);
    t.personal.setBudget('IDR', 2_000_000_000);
    expectCode(() => t.personal.setBudget('USD', 0), 'finance_invalid');
    expect(t.personal.setBudget('IDR', null).map((b) => b.currency)).toEqual(['TRY']);
    expect(t.personal.list().budgets).toHaveLength(1);
  });

  it('data survives a restart', () => {
    const file = tmpFile();
    const a = setup(file);
    a.kite.create(kiteEntry({ kind: 'receivable', dueDate: '2026-10-15' }));
    a.personal.createEntry(personalEntry());
    const d = a.personal.createDebt(debtInput());
    a.personal.addPayment(d.id, { amountMinor: 1_000_000, paidOn: '2026-10-01', notes: 'Havale' });
    a.personal.setBudget('TRY', 4_000_000);
    const kiteBefore = a.kite.list();
    const personalBefore = a.personal.list();
    a.store.close();
    stores.splice(stores.indexOf(a.store), 1);
    const b = setup(file);
    expect(b.kite.list()).toEqual(kiteBefore);
    expect(b.personal.list()).toEqual(personalBefore);
  });
});

describe('HTTP', () => {
  async function serve() {
    const t = setup();
    const finance = { kite: t.kite, personal: t.personal };
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, data: t.data, finance, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { t, call, base };
  }

  it('KITE flow, validation, cross-site refusal and unknown paths', async () => {
    const { t, call, base } = await serve();
    expect(await (await call('GET', '/api/finance/kite')).json()).toEqual({ entries: [] });
    const created = await call('POST', '/api/finance/kite/entries', { entry: kiteEntry({ kind: 'receivable', dueDate: '2026-10-15' }) });
    expect(created.status).toBe(201);
    const { entry, entries } = (await created.json()) as { entry: { id: string }; entries: unknown[] };
    expect(entries).toHaveLength(1);
    const paid = await call('POST', `/api/finance/kite/entries/${entry.id}/status`, { to: 'paid', paidOn: '2026-10-16' });
    expect(((await paid.json()) as { entry: { status: string } }).entry.status).toBe('paid');
    expect((await call('POST', '/api/finance/kite/entries', { entry: kiteEntry() }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', '/api/finance/kite/entries', { entry: kiteEntry({ currency: 'GBP' as never }) })).status).toBe(400);
    expect((await call('POST', '/api/finance/kite/entries', { entry: kiteEntry({ amountMinor: 12.5 }) })).status).toBe(400);
    expect((await call('POST', '/api/finance/kite/entries', { entry: kiteEntry({ notes: 'password=abc' }) })).status).toBe(400);
    expect((await call('POST', `/api/finance/kite/entries/${entry.id}/delete`, {}, { origin: 'https://evil.example' })).status).toBe(403);
    // A form-style (non-JSON) post is refused too.
    expect((await fetch(`${base}/api/finance/kite/entries/${entry.id}/delete`, { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await call('GET', '/api/finance/nope')).status).toBe(404);
    expect((await call('POST', '/api/finance/kite/entries/kfe_missing/next', {})).status).toBe(404);
    expect((await (await call('POST', `/api/finance/kite/entries/${entry.id}/delete`, {})).json())).toEqual({ entries: [] });
    expect(t.personal.list()).toEqual({ entries: [], debts: [], budgets: [] });
  });

  it('Berk flow: entries, debt with repayments, overpayment 409, budget', async () => {
    const { t, call } = await serve();
    expect((await call('POST', '/api/finance/personal/entries', { entry: personalEntry() })).status).toBe(201);
    const debtRes = await call('POST', '/api/finance/personal/debts', { debt: debtInput() });
    const { debt } = (await debtRes.json()) as { debt: { id: string } };
    expect((await call('POST', `/api/finance/personal/debts/${debt.id}/payments`, { payment: { amountMinor: 4_000_000, paidOn: '2026-10-01', notes: '' } })).status).toBe(201);
    const over = await call('POST', `/api/finance/personal/debts/${debt.id}/payments`, { payment: { amountMinor: 9_000_000, paidOn: '2026-10-02', notes: '' } });
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('debt_overpayment');
    const budget = await call('PUT', '/api/finance/personal/budgets/TRY', { monthlyLimitMinor: 4_000_000 });
    expect(((await budget.json()) as { budgets: unknown[] }).budgets).toHaveLength(1);
    expect((await call('PUT', '/api/finance/personal/budgets/GBP', { monthlyLimitMinor: 1 })).status).toBe(400);
    const data = t.personal.list();
    expect(data.entries).toHaveLength(1);
    expect(debtRemaining(data.debts[0])).toBe(8_000_000);
    expect(t.kite.list().entries).toEqual([]);
  });

  it('answers 503 without a database and never touches unrelated tables', async () => {
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    expect((await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/finance/kite`)).status).toBe(503);

    const { t, call } = await serve();
    const others = tables(t.store.db).filter((x) => !FINANCE_TABLES.includes(x));
    const before = fingerprint(t.store.db, others);
    await call('POST', '/api/finance/kite/entries', { entry: kiteEntry() });
    await call('POST', '/api/finance/personal/entries', { entry: personalEntry() });
    await call('POST', '/api/finance/personal/debts', { debt: debtInput() });
    await call('PUT', '/api/finance/personal/budgets/USD', { monthlyLimitMinor: 50_000 });
    expect(fingerprint(t.store.db, others)).toEqual(before);
  });
});
