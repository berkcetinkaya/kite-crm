// Phase 9: customers, services, onboarding checklist and access requirements (schema v5, service, HTTP).
// The upgrade test builds a realistic v4 database through the real Phase 6/7/8 code paths. Fixture
// Gmail only; no network, no email, no Anthropic.
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCESS_KINDS,
  ACCESS_STATUSES,
  containsSecret,
  CUSTOMER_SERVICE_STATUSES,
  CUSTOMER_STATUSES,
  customerBlockers,
  ONBOARDING_STATUSES,
  onboardingProgress,
  suggestedAccess,
  suggestedOnboarding,
  type StartOnboardingInput,
} from '../../src/domain/customers';
import type { ProposalInput } from '../../src/domain/sales';
import type { NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createApp } from '../app';
import { createClock } from '../clock';
import { loadConfig } from '../config';
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
import { createCustomerService, CustomerError } from './service';

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
  const d = mkdtempSync(path.join(tmpdir(), 'kite-p9-'));
  dirs.push(d);
  return path.join(d, 'kite.db');
};

const companyInput = (over: Partial<NewCompanyInput> = {}): NewCompanyInput => ({
  name: 'Lyxa Klinik',
  website: null,
  sector: 'Güzellik Markası',
  city: 'İstanbul',
  country: 'Türkiye',
  source: 'manual',
  opportunities: [{ service: 'meta_ads', score: null, potential: null, reason: '' }],
  opportunityScore: null,
  status: 'client',
  owner: 'Berk Çetinkaya',
  note: '',
  contacts: [{ fullName: 'Aytül Kaya', role: 'Kurucu', email: 'aytul@lyxa.example', phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' }],
  ...over,
});

const proposal: ProposalInput = {
  title: 'Büyüme paketi',
  currency: 'TRY',
  contractMonths: 6,
  validUntil: null,
  notes: '',
  taxMode: 'excluded',
  taxRateBp: 2000,
  items: [
    { service: 'meta_ads', description: 'Meta reklam yönetimi', billingType: 'monthly', unitAmountMinor: 2_500_000, quantity: 1 },
    { service: 'google_ads', description: 'Google Ads', billingType: 'monthly', unitAmountMinor: 1_500_000, quantity: 1 },
    { service: 'creative', description: 'Kreatif paket', billingType: 'one_time', unitAmountMinor: 1_000_000, quantity: 1 },
  ],
};

function setup(file = ':memory:', status: NewCompanyInput['status'] = 'client') {
  const clock = createClock(0, () => Date.parse('2026-10-06T09:00:00.000Z'));
  const now = () => clock.now();
  const store = openStore(file);
  stores.push(store);
  const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
  const data = createPersistenceServices(store, { now, followUps: planner });
  const sales = createSalesService(store, { now, followUps: planner });
  const customers = createCustomerService(store, { now, followUps: planner });
  const company = data.companies.create(companyInput({ status }));
  return { clock, store, data, sales, customers, company, get: () => store.companies.get(company.id)! };
}

/** An accepted proposal for the company (through the real Phase 8 flow). */
function acceptedProposal(t: ReturnType<typeof setup>) {
  const { proposal: p } = t.sales.createProposal(t.company.id, proposal);
  t.sales.transitionProposal(p.id, { to: 'ready' });
  t.sales.transitionProposal(p.id, { to: 'sent', sentAt: '2026-10-05T12:00:00.000Z' });
  return t.sales.transitionProposal(p.id, { to: 'accepted' }).proposal;
}

const start = (over: Partial<StartOnboardingInput> = {}): StartOnboardingInput => ({
  startDate: '2026-10-06T12:00:00.000Z',
  primaryContactId: null,
  commercialNotes: '6 ay, aylık rapor',
  operationalNotes: '',
  sourceProposalId: null,
  services: [],
  onboardingItems: [],
  accessItems: [],
  moveCompanyToClient: false,
  ...over,
});

async function expectCode(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CustomerError);
    expect((e as CustomerError).code).toBe(code);
    return e as CustomerError;
  }
  throw new Error(`expected ${code}`);
}

// ---------------------------------------------------------------------------------------------

const TABLES = ['companies', 'company_contacts', 'company_notes', 'company_history', 'company_opportunities', 'research_jobs', 'research_results', 'mail_drafts', 'mail_draft_versions', 'outbound_messages', 'mail_messages', 'mail_sync_runs', 'follow_up_sequences', 'follow_up_steps', 'app_settings', 'meetings', 'proposals', 'proposal_items'];
const snapshot = (db: Db) => Object.fromEntries(TABLES.map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())]));

describe('schema v5', () => {
  it('a fresh installation goes straight to v5 with the four customer tables', () => {
    const s = openStore(':memory:');
    stores.push(s);
    expect(s.schemaVersion).toBe(5);
    for (const t of ['customers', 'customer_services', 'onboarding_items', 'access_requirements']) expect(s.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)).toEqual({ n: 1 });
  });

  it('literal enumerations in v5 match the customer domain', () => {
    const list = (v: readonly string[]) => v.map((x) => `'${x}'`).join(',');
    const sql = MIGRATIONS.find((m) => m.version === 5)!.sql;
    for (const values of [CUSTOMER_STATUSES, CUSTOMER_SERVICE_STATUSES, ONBOARDING_STATUSES, ACCESS_KINDS, ACCESS_STATUSES]) expect(sql).toContain(list(values));
    expect(MIGRATIONS.find((m) => m.version === 5)!.foreignKeysOff).toBeUndefined();
  });

  it('upgrades a Phase 8 database (sends, reply, follow-ups, meetings, proposals) without changing any row', async () => {
    const file = tmpFile();
    const db = openDatabase(file);
    dbs.push(db);
    runMigrations(db, MIGRATIONS.filter((m) => m.version <= 4));
    const store = createStore(db);
    const clock = createClock(0, () => Date.parse('2026-10-06T09:00:00.000Z'));
    const now = () => clock.now();
    const fx = createFixtureGmail({ redirectUri: '/cb', now: () => clock.now().getTime() });
    const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials: createMemoryCredentialStore() });
    const { state } = gmail.beginAuthorization();
    await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
    const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
    const data = createPersistenceServices(store, { now, mailProvider: createFixtureMailProvider(), followUps: planner });
    const outreach = createOutreachService(store, gmail, { now, followUps: planner });
    const sales = createSalesService(store, { now, followUps: planner });
    for (const [name, email] of [['Replied Co', 'a@replied.example'], ['Waiting Co', 'a@waiting.example']] as const) {
      const c = data.companies.create(companyInput({ name, status: 'researched', contacts: [{ fullName: 'A', role: '', email, phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' }] }));
      const d = await data.mail.generate({ companyId: c.id, service: 'meta_ads', language: 'tr', contactId: null, preserve: null });
      data.mail.approve(d.id, { selectedSubject: d.selectedSubject, body: d.body });
      await outreach.send({ draftId: d.id, companyId: c.id, contactId: c.contacts[0].id, idempotencyKey: `idem_p9_${name.replace(/\W/g, '')}_00001` });
    }
    const replied = store.outreach.listThreadSends().find((s) => s.recipientEmail === 'a@replied.example')!;
    fx.controls.addReply(replied.gmailThreadId!, { shape: 'reply' });
    await outreach.sync();
    sales.createMeeting(replied.companyId, { scheduledAt: '2026-10-06T10:00:00.000Z', type: 'online', contactId: null, notes: 'n', outcome: '', nextActionLabel: null, nextActionDueAt: null });
    const { proposal: p } = sales.createProposal(replied.companyId, proposal);
    sales.transitionProposal(p.id, { to: 'ready' });
    sales.transitionProposal(p.id, { to: 'sent', sentAt: '2026-10-06T09:00:00.000Z' });
    sales.transitionProposal(p.id, { to: 'accepted' });
    const before = snapshot(db);
    expect(JSON.parse(before.proposal_items)).toHaveLength(3);
    expect(JSON.parse(before.meetings)).toHaveLength(1);
    expect(JSON.parse(before.follow_up_sequences)).toHaveLength(2);
    db.close();

    const s = openStore(file);
    stores.push(s);
    expect(s.schemaVersion).toBe(5);
    expect(snapshot(s.db)).toEqual(before);
    expect(s.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(s.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(s.customers.list()).toEqual([]); // never created retroactively
    expect(runMigrations(s.db)).toEqual({ applied: [], version: 5 });
  });

  it('the database refuses inconsistent customer rows', () => {
    const t = setup();
    const { customer } = t.customers.startOnboarding(t.company.id, start());
    const raw = (sql: string, ...a: (string | number | null)[]) => () => t.store.db.prepare(sql).run(...a);
    expect(raw("INSERT INTO customers (id, company_id, status, start_date, onboarding_started_at, created_at, updated_at) VALUES ('cus_dup', ?, 'active', '2026-01-01', 'x', 'x', 'x')", t.company.id)).toThrow(/UNIQUE/);
    expect(raw("UPDATE customers SET end_date = '2026-01-01' WHERE id = ?", customer.id)).toThrow(/CHECK/);
    expect(raw("INSERT INTO onboarding_items (id, customer_id, position, label, status, created_at, updated_at) VALUES ('onb_x', ?, 0, 'x', 'done', 'x', 'x')", customer.id)).toThrow(/CHECK/);
    expect(raw("INSERT INTO access_requirements (id, customer_id, position, kind, label, status, created_at, updated_at) VALUES ('acc_x', ?, 0, 'ga4', 'x', 'received', 'x', 'x')", customer.id)).toThrow(/CHECK/);
    expect(raw("INSERT INTO customer_services (id, customer_id, service, status, amount_minor, created_at, updated_at) VALUES ('csv_x', ?, 'seo', 'active', -5, 'x', 'x')", customer.id)).toThrow(/CHECK/);
  });
});

describe('starting onboarding', () => {
  it('requires the Müşteri stage unless the move is explicitly requested (a normal status change)', async () => {
    const t = setup(':memory:', 'awaiting_decision');
    await expectCode(() => t.customers.startOnboarding(t.company.id, start()), 'customer_stage_required');
    expect(t.store.customers.list()).toEqual([]);
    expect(t.get().status).toBe('awaiting_decision');
    const r = t.customers.startOnboarding(t.company.id, start({ moveCompanyToClient: true }));
    expect(r.company.status).toBe('client');
    expect(r.company.history.some((h) => h.type === 'status_changed' && h.description === 'Durum Karar Bekleniyor → Müşteri olarak değiştirildi')).toBe(true);
    expect(r.customer.status).toBe('onboarding');
  });

  it('from an accepted proposal: services prefilled as editable copies, checklist and access chosen; nothing activated', () => {
    const t = setup();
    const p = acceptedProposal(t);
    const services = p.items.map((i) => ({ service: i.service, label: '', billingType: i.billingType, amountMinor: i.unitAmountMinor * i.quantity, currency: p.currency, sourceProposalId: p.id, sourceItemId: i.id, notes: i.description, startDate: null, endDate: null }));
    const kinds = suggestedAccess(p.items.map((i) => i.service));
    const r = t.customers.startOnboarding(
      t.company.id,
      start({
        sourceProposalId: p.id,
        primaryContactId: t.company.contacts[0].id,
        services,
        onboardingItems: suggestedOnboarding(p.items.map((i) => i.service)).map((x) => ({ label: x.label, templateKey: x.key, dueDate: null, notes: '' })),
        accessItems: kinds.map((kind) => ({ kind, label: '', notes: '' })),
      }),
    );
    const c = r.customer;
    expect(c).toMatchObject({ status: 'onboarding', sourceProposalId: p.id, primaryContactName: 'Aytül Kaya', primaryContactEmail: 'aytul@lyxa.example', onboardingCompletedAt: null });
    expect(c.services.map((s) => [s.service, s.status, s.billingType, s.amountMinor, s.currency, s.sourceItemId !== null])).toEqual([
      ['meta_ads', 'preparing', 'monthly', 2_500_000, 'TRY', true],
      ['google_ads', 'preparing', 'monthly', 1_500_000, 'TRY', true],
      ['creative', 'preparing', 'one_time', 1_000_000, 'TRY', true],
    ]);
    expect(c.onboarding.map((i) => i.templateKey)).toEqual(expect.arrayContaining(['contract', 'kickoff', 'past_ads', 'audience', 'creative_brief']));
    expect(c.onboarding.every((i) => i.status === 'pending')).toBe(true);
    expect(c.access.map((a) => [a.kind, a.label, a.status]).sort()).toEqual([
      ['ga4', 'GA4 erişimi', 'not_requested'],
      ['google_ads', 'Google Ads erişimi', 'not_requested'],
      ['meta_business', 'Meta Business erişimi', 'not_requested'],
    ]);
    expect(r.company.history[0]).toMatchObject({ type: 'customer' });
    expect(r.company.history[0].description).toMatch(/^Müşteri onboarding'i başlatıldı: başlangıç 6 Eki 2026 · 3 hizmet · kabul edilen tekliften$/);
    // Copies: reopening and editing the proposal later never changes the customer's services.
    t.sales.transitionProposal(p.id, { to: 'draft' });
    t.sales.updateProposal(p.id, { ...proposal, items: [proposal.items[0]] });
    expect(t.store.customers.get(c.id)!.services).toHaveLength(3);
  });

  it('refuses a second customer, an unaccepted proposal and a contact of another company', async () => {
    const t = setup();
    const { proposal: draft } = t.sales.createProposal(t.company.id, proposal);
    await expectCode(() => t.customers.startOnboarding(t.company.id, start({ sourceProposalId: draft.id })), 'customer_proposal_invalid');
    await expectCode(() => t.customers.startOnboarding(t.company.id, start({ primaryContactId: 'ct_other_1' })), 'customer_contact_missing');
    t.customers.startOnboarding(t.company.id, start());
    await expectCode(() => t.customers.startOnboarding(t.company.id, start()), 'customer_exists');
  });

  it('refuses clear credential patterns but accepts ordinary long notes', async () => {
    const t = setup();
    for (const bad of ['password: hunter2', 'Şifre: 1234', 'api key: abc', 'Secret = xyz', 'token: abc', 'Authorization: Bearer abcdefghijklmnop']) {
      expect(containsSecret(bad)).toBe(true);
      await expectCode(() => t.customers.startOnboarding(t.company.id, start({ operationalNotes: bad })), 'customer_secret');
    }
    for (const fine of ['Kampanya kimliği 23847562938475629384756 Meta panelinde', 'Token bütçesi sonra konuşulacak', 'Şifreyi müşteri kendisi girecek', 'GA4 property G-ABC123XYZ']) expect(containsSecret(fine)).toBe(false);
    const { customer } = t.customers.startOnboarding(t.company.id, start({ operationalNotes: 'Kampanya kimliği 23847562938475629384756' }));
    await expectCode(() => t.customers.addAccess(customer.id, [{ kind: 'ga4', label: '', notes: 'password: x' }]), 'customer_secret');
  });
});

describe('customer lifecycle and services', () => {
  function started() {
    const t = setup();
    const { customer } = t.customers.startOnboarding(
      t.company.id,
      start({ onboardingItems: [{ label: 'Kickoff toplantısı', templateKey: 'kickoff', dueDate: '2026-10-04T12:00:00.000Z', notes: '' }, { label: 'Marka materyalleri', templateKey: null, dueDate: null, notes: '' }] }),
    );
    return { t, customer };
  }

  it('completing onboarding with open items needs explicit confirmation; then Aktif with history', async () => {
    const { t, customer } = started();
    const e = await expectCode(() => t.customers.changeStatus(customer.id, { to: 'active' }), 'customer_onboarding_open');
    expect(e.extra.open).toBe(2);
    const r = t.customers.changeStatus(customer.id, { to: 'active', confirmOpenItems: true });
    expect(r.customer).toMatchObject({ status: 'active', onboardingCompletedAt: '2026-10-06T09:00:00.000Z' });
    expect(r.company.history[0]).toMatchObject({ type: 'onboarding', description: 'Onboarding tamamlandı; müşteri Aktif' });
    expect(r.company.status).toBe('client');
  });

  it('status transitions are explicit and reversible; Kaybedildi never moves the sales stage unless asked', async () => {
    const { t, customer } = started();
    await expectCode(() => t.customers.changeStatus(customer.id, { to: 'completed' }), 'customer_invalid_transition');
    t.customers.changeStatus(customer.id, { to: 'on_hold' });
    const lost = t.customers.changeStatus(customer.id, { to: 'lost' });
    // Ended earlier on the start day: the end is never before the start.
    expect(lost.customer).toMatchObject({ status: 'lost', endDate: '2026-10-06T12:00:00.000Z' });
    expect(lost.company.status).toBe('client');
    const back = t.customers.changeStatus(customer.id, { to: 'onboarding' });
    expect(back.customer).toMatchObject({ status: 'onboarding', endDate: null, onboardingCompletedAt: null });
    t.customers.changeStatus(customer.id, { to: 'active', confirmOpenItems: true });
    const done = t.customers.changeStatus(customer.id, { to: 'lost', moveCompanyTo: 'lost' });
    expect(done.company.status).toBe('lost');
    expect(done.company.history.some((h) => h.description === 'Müşteri durumu: Aktif → Kaybedildi')).toBe(true);
  });

  it('several services of one type with scopes; explicit activation sets the start, closing the end', async () => {
    const { t, customer } = started();
    const svc = (label: string) => ({ service: 'meta_ads' as const, label, billingType: 'monthly' as const, amountMinor: 2_000_000, currency: 'TRY' as const, sourceProposalId: null, sourceItemId: null, notes: '', startDate: null, endDate: null });
    t.customers.addService(customer.id, svc('Türkiye'));
    const r = t.customers.addService(customer.id, svc('Gulf'));
    expect(r.customer.services.map((s) => [s.service, s.label, s.status])).toEqual([['meta_ads', 'Türkiye', 'preparing'], ['meta_ads', 'Gulf', 'preparing']]);
    const id = r.customer.services[1].id;
    const active = t.customers.changeServiceStatus(id, 'active');
    expect(active.customer.services[1]).toMatchObject({ status: 'active', startDate: '2026-10-06T09:00:00.000Z', endDate: null });
    expect(active.company.history[0].description).toBe('Hizmet Meta Ads · Gulf: Hazırlanıyor → Aktif');
    const edited = t.customers.updateService(id, { ...svc('Gulf (UAE + KSA)'), amountMinor: 2_500_000, startDate: '2026-10-06T09:00:00.000Z' });
    expect(edited.customer.services[1]).toMatchObject({ label: 'Gulf (UAE + KSA)', amountMinor: 2_500_000, status: 'active' });
    const closed = t.customers.changeServiceStatus(id, 'completed', '2026-12-31T12:00:00.000Z');
    expect(closed.customer.services[1]).toMatchObject({ status: 'completed', endDate: '2026-12-31T12:00:00.000Z' });
    await expectCode(() => t.customers.changeServiceStatus(id, 'completed'), 'customer_invalid_transition');
    expect(t.store.customers.get(customer.id)!.status).toBe('onboarding'); // services never move the customer
  });

  it('responsible person is the company owner (normal history); details and contact snapshot update', () => {
    const { t, customer } = started();
    const r = t.customers.updateCustomer(customer.id, { startDate: '2026-10-07T12:00:00.000Z', endDate: null, primaryContactId: t.company.contacts[0].id, commercialNotes: 'Yeni not', operationalNotes: 'Haftalık rapor' }, null);
    expect(r.customer).toMatchObject({ startDate: '2026-10-07T12:00:00.000Z', primaryContactName: 'Aytül Kaya', commercialNotes: 'Yeni not' });
    expect(r.company.owner).toBeNull();
    expect(r.company.history[0]).toMatchObject({ type: 'details_updated', description: 'Şirket bilgileri güncellendi: Sorumlu' });
  });
});

describe('onboarding checklist and access', () => {
  it('checklist items: add custom, complete, not needed, delete; progress and blocked are derived', () => {
    const t = setup();
    const { customer } = t.customers.startOnboarding(t.company.id, start({ onboardingItems: [{ label: 'Kickoff toplantısı', templateKey: 'kickoff', dueDate: '2026-10-04T12:00:00.000Z', notes: '' }] }));
    const added = t.customers.addOnboardingItems(customer.id, [{ label: 'Özel adım', templateKey: null, dueDate: null, notes: '' }, { label: 'Silinecek', templateKey: null, dueDate: null, notes: '' }]).customer;
    expect(added.onboarding.map((i) => [i.position, i.label])).toEqual([[0, 'Kickoff toplantısı'], [1, 'Özel adım'], [2, 'Silinecek']]);
    expect(customerBlockers(added, '2026-10-06T09:00:00.000Z')).toEqual(['Gecikmiş onboarding adımı: Kickoff toplantısı']);
    t.customers.setOnboardingStatus(added.onboarding[0].id, 'done');
    t.customers.setOnboardingStatus(added.onboarding[1].id, 'not_needed');
    const after = t.customers.deleteOnboardingItem(added.onboarding[2].id).customer;
    expect(after.onboarding[0]).toMatchObject({ status: 'done', completedAt: '2026-10-06T09:00:00.000Z' });
    expect(onboardingProgress(after.onboarding)).toEqual({ done: 1, total: 1, open: 0 });
    expect(customerBlockers(after, '2026-10-06T09:00:00.000Z')).toEqual([]);
    const reopened = t.customers.setOnboardingStatus(added.onboarding[0].id, 'in_progress').customer;
    expect(reopened.onboarding[0].completedAt).toBeNull();
  });

  it('access: requested / received / problem are explicit, recorded with dates and history; never automatic', () => {
    const t = setup();
    const { customer } = t.customers.startOnboarding(t.company.id, start({ accessItems: [{ kind: 'meta_business', label: '', notes: '' }] }));
    const id = customer.access[0].id;
    const req = t.customers.setAccessStatus(id, 'requested');
    expect(req.customer.access[0]).toMatchObject({ status: 'requested', requestedAt: '2026-10-06T09:00:00.000Z', receivedAt: null });
    expect(req.company.history[0]).toMatchObject({ type: 'access', description: 'Meta Business erişimi: İstenmedi → İstendi' });
    const problem = t.customers.setAccessStatus(id, 'problem').customer;
    expect(customerBlockers(problem, '2026-10-06T09:00:00.000Z')).toEqual(['Erişim sorunu: Meta Business erişimi']);
    const received = t.customers.setAccessStatus(id, 'received').customer.access[0];
    expect(received).toMatchObject({ status: 'received', requestedAt: '2026-10-06T09:00:00.000Z', receivedAt: '2026-10-06T09:00:00.000Z' });
    expect(t.customers.updateAccess(id, { label: 'Meta BM (Lyxa)', notes: 'Yönetici olarak eklendi' }).customer.access[0].label).toBe('Meta BM (Lyxa)');
    expect(t.customers.deleteAccess(id).customer.access).toEqual([]);
  });

  it('customer actions never touch lastContactAt, sends or follow-ups; data survives a restart', () => {
    const file = tmpFile();
    const t = setup(file);
    const before = t.get().lastContactAt;
    const { customer } = t.customers.startOnboarding(t.company.id, start({ accessItems: [{ kind: 'ga4', label: '', notes: '' }], onboardingItems: [{ label: 'Kickoff', templateKey: null, dueDate: null, notes: '' }] }));
    t.customers.setAccessStatus(customer.access[0].id, 'requested');
    t.customers.changeStatus(customer.id, { to: 'active', confirmOpenItems: true });
    expect(t.get().lastContactAt).toBe(before);
    expect(t.store.outreach.listSends()).toEqual([]);
    expect(t.store.followUps.list()).toEqual([]);
    const saved = t.store.customers.get(customer.id);
    t.store.close();
    const again = openStore(file);
    stores.push(again);
    expect(again.customers.get(customer.id)).toEqual(saved);
  });
});

describe('HTTP', () => {
  it('starts onboarding through the API; refuses cross-site requests, secrets and invalid input', async () => {
    const t = setup();
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, data: t.data, sales: t.sales, customers: t.customers, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (method: string, p: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

    expect((await send('POST', '/api/customers', { companyId: t.company.id, onboarding: start() }, { origin: 'https://evil.example' })).status).toBe(403);
    const secret = await send('POST', '/api/customers', { companyId: t.company.id, onboarding: start({ commercialNotes: 'api key: sk-123' }) });
    expect(secret.status).toBe(400);
    expect(((await secret.json()) as { error: { message: string } }).error.message).toMatch(/Şifre, API key veya token saklamayın/);
    expect((await send('POST', '/api/customers', { companyId: t.company.id, onboarding: { ...start(), services: [{ service: 'tiktok' }] } })).status).toBe(400);
    const created = await send('POST', '/api/customers', { companyId: t.company.id, onboarding: start({ accessItems: [{ kind: 'ga4', label: '', notes: '' }] }) });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { customer: { id: string; access: { id: string }[] } };
    const list = (await (await fetch(`${base}/api/customers`)).json()) as { customers: unknown[] };
    expect(list.customers).toHaveLength(1);
    const open = await send('POST', `/api/customers/${body.customer.id}/status`, { to: 'completed' });
    expect(open.status).toBe(409);
    expect((await send('POST', `/api/customers/access/${body.customer.access[0].id}/status`, { to: 'received' })).status).toBe(200);
  });
});
