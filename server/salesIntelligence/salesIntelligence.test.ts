// Phase 14 server: shared snapshot (bounded repository calls), Phase 13 readiness parity, the
// read-only sales intelligence API, the dashboard focus list and an end-to-end reply flow.
// Fixture Gmail and the fixture mail writer only; nothing real is sent.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { SalesInsight, SalesIntelligence } from '../../src/domain/salesIntelligence';
import type { ContactInput, NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createApp } from '../app';
import { createClock } from '../clock';
import { loadConfig } from '../config';
import { createStore, openStore, type OpenedStore } from '../db/store';
import type { Store } from '../db/repositories/types';
import { sampleJob, sampleResult, seedFirstContactDraft } from '../db/testFixtures';
import { createFollowUpPlanner } from '../followUp/service';
import { createGmailAdapter } from '../gmail/adapter';
import { createMemoryCredentialStore } from '../gmail/credentialStore';
import { createFixtureGmail, FIXTURE_AUTH_CODE } from '../gmail/fixture';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { createOutreachService } from '../outreach/service';
import { createOutreachPrepService, loadReadiness } from '../outreachPrep/service';
import { createPersistenceServices } from '../persistence/services';
import { createReportingService } from '../reporting/service';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createSalesService } from '../sales/service';
import { createCustomerService } from '../customers/service';
import { createWorkService } from '../work/service';
import { createSalesIntelligenceService } from './service';
import { loadReadinessSnapshot, readinessFromSnapshot } from './snapshot';

const BASE = Date.parse('2026-10-09T09:00:00.000Z');
const stores: OpenedStore[] = [];
const servers: http.Server[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  stores.splice(0).forEach((s) => s.close());
});

const input = (name: string, over: Partial<NewCompanyInput> = {}): NewCompanyInput => ({
  name, website: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example`, sector: 'Diş Kliniği', city: 'İzmir', country: 'Türkiye', source: 'manual',
  opportunities: [{ service: 'crm', score: 60, potential: 'medium', reason: '' }], opportunityScore: 60, status: 'researched', owner: 'Berk Çetinkaya', note: '', ...over,
});
const person = (email: string): ContactInput => ({ fullName: 'Dr. Ece Aydın', role: 'Müdür', email, phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' });

/** Counts every repository method call made through the store. */
function counting(store: Store) {
  const calls = new Map<string, number>();
  const wrap = <T extends object>(name: string, repo: T): T =>
    new Proxy(repo, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          const k = `${name}.${String(prop)}`;
          calls.set(k, (calls.get(k) ?? 0) + 1);
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  const counted: Store = { ...store };
  for (const key of ['companies', 'research', 'mail', 'outreach', 'followUps', 'settings', 'sales', 'customers', 'tasks', 'discovery', 'outreachPrep'] as const) (counted as unknown as Record<string, object>)[key] = wrap(key, store[key] as object);
  return { store: counted, calls, reset: () => calls.clear() };
}

async function setup() {
  const store = openStore(':memory:');
  stores.push(store);
  const clock = createClock(0, () => BASE);
  const now = () => clock.now();
  const mailProvider = createFixtureMailProvider();
  const followUps = createFollowUpPlanner(store, { now, mailProvider });
  const data = createPersistenceServices(store, { now, mailProvider, followUps });
  const fx = createFixtureGmail({ redirectUri: '/cb', now: () => clock.now().getTime() });
  const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials: createMemoryCredentialStore() });
  const { state } = gmail.beginAuthorization();
  await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
  const outreach = createOutreachService(store, gmail, { now, followUps });
  const sales = createSalesService(store, { now, followUps });
  const customers = createCustomerService(store, { now, followUps });
  const intelligence = createSalesIntelligenceService(store, { now, followUps });
  const reporting = createReportingService(store, { now, followUps });
  /** A company that received a first contact through the fixture Gmail. */
  const contacted = async (name: string, email: string) => {
    const c0 = data.companies.create(input(name));
    const c = data.companies.addContact(c0.id, person(email));
    const d = seedFirstContactDraft(store, c.id, { at: now().toISOString() });
    data.mail.approve(d.id, { selectedSubject: d.selectedSubject, body: d.body });
    await outreach.send({ draftId: d.id, companyId: c.id, contactId: c.contacts[0].id, idempotencyKey: `idem_p14_${name.replace(/\W/g, '')}_00001` });
    return store.companies.get(c.id)!;
  };
  return { store, clock, now, data, outreach, sales, customers, followUps, intelligence, reporting, fx, contacted };
}

/** Every table's rows and every schema object. */
const fingerprint = (s: OpenedStore) => {
  const schema = s.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const tables = (s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  return JSON.stringify({ schema, rows: Object.fromEntries(tables.map((t) => [t, s.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()])) });
};

describe('end-to-end over real records', () => {
  it('a fresh reply is Yüksek, an unanswered one becomes Kritik with "Yanıta dön"; the planned next action is kept', async () => {
    const t = await setup();
    const c = await t.contacted('Reply Clinic', 'reply@reply-clinic.example');
    t.fx.controls.addReply(t.store.outreach.listThreadSends()[0].gmailThreadId!, { shape: 'reply', at: BASE + 3_600_000 });
    await t.outreach.sync();
    t.data.companies.updateDetails(c.id, { nextAction: { label: 'Cuma WhatsApp', dueAt: new Date(BASE + 3 * 86_400_000).toISOString() } });
    let i = t.intelligence.company(c.id);
    expect(i.stage).toBe('replied');
    expect(i.priority!.level).toBe('high');
    expect(i.action).toMatchObject({ key: 'answer_reply', link: { type: 'mail', companyId: c.id } });
    expect(i.planned).toMatchObject({ label: 'Cuma WhatsApp' });
    t.clock.setOffsetMs(3 * 86_400_000);
    i = t.intelligence.company(c.id);
    expect(i.priority!.level).toBe('critical');
    expect(i.momentum!.state).toBe('cooling');
    expect(i.flags.map((f) => f.key)).toContain('reply_no_action');
    expect(t.store.companies.get(c.id)!.nextAction!.label).toBe('Cuma WhatsApp');
  });

  it('customers and closed companies are excluded from the ranked list but answer the single-company call', async () => {
    const t = await setup();
    const won = t.data.companies.create(input('Won Co', { status: 'client' }));
    t.data.companies.create(input('Open Co', { status: 'first_contact' }));
    const list = t.intelligence.list();
    expect(list.insights.map((i) => i.companyName)).toEqual(['Open Co']);
    expect(t.intelligence.company(won.id).excluded).toMatch(/Müşteri/);
    expect(() => t.intelligence.company('cmp_missing')).toThrow();
  });

  it('dashboard focus: at most 5, above Normal, companies already in Bugün skipped', async () => {
    const t = await setup();
    for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) t.data.companies.create(input(`Focus ${n}`, { status: 'first_contact' }));
    const overdue = t.data.companies.create(input('In Bugün', { status: 'first_contact' }));
    t.data.companies.updateDetails(overdue.id, { nextAction: { label: 'Ara', dueAt: new Date(BASE - 5 * 86_400_000).toISOString() } });
    const d = t.reporting.dashboard('30d');
    expect(d.attention.map((a) => a.companyId)).toContain(overdue.id);
    expect(d.focus).toHaveLength(5);
    expect(d.focus.map((i: SalesInsight) => i.companyId)).not.toContain(overdue.id);
    expect(d.focus.every((i: SalesInsight) => i.priority && i.priority.level !== 'normal')).toBe(true);
  });
});

describe('shared snapshot', () => {
  it('repository calls stay bounded however many companies there are (no per-company or per-sequence reads)', async () => {
    const t = await setup();
    for (let n = 0; n < 6; n++) await t.contacted(`Clinic ${n}`, `c${n}@clinic-${n}.example`);
    for (let n = 0; n < 6; n++) t.data.companies.create(input(`Pre ${n}`));
    const counted = counting(t.store);
    const followUps = createFollowUpPlanner(counted.store, { now: t.now });
    const services = {
      intelligence: () => createSalesIntelligenceService(counted.store, { now: t.now, followUps }).list(),
      dashboard: () => createReportingService(counted.store, { now: t.now, followUps }).dashboard('30d'),
      work: () => createWorkService(counted.store, { now: t.now, followUps }).work(7),
      readiness: () => createOutreachPrepService(counted.store, { now: t.now, maxRealGenerationsPerDay: 30 }).overview(),
    };
    for (const [name, call] of Object.entries(services)) {
      counted.reset();
      call();
      const perCompany = [...counted.calls.entries()].filter(([k, v]) => v > 1 && !k.startsWith('settings.'));
      expect(perCompany, name).toEqual([]);
      for (const k of ['companies.get', 'mail.getByCompany', 'research.findTransferredResult', 'outreach.listThreadMessages', 'followUps.listByCompany', 'customers.getByCompany', 'outreachPrep.get']) expect(counted.calls.get(k) ?? 0, `${name}: ${k}`).toBe(0);
    }
  });

  it('readiness from the snapshot equals the per-company Phase 13 readiness for every company', async () => {
    const t = await setup();
    await t.contacted('Sent Co', 'sent@sent-co.example');
    const pre = t.data.companies.addContact(t.data.companies.create(input('Pre Co')).id, person('pre@pre-co.example'));
    t.data.companies.create(input('Twin', { website: null }));
    t.data.companies.create(input('Twin', { website: null }));
    t.data.companies.create(input('Lost Co', { status: 'lost' }));
    const linked = t.data.companies.addContact(t.data.companies.create(input('Linked Co')).id, person('info@linked-co.example'));
    t.store.research.saveJob(sampleJob({ id: 'rsch_p14' }));
    t.store.research.saveResults('rsch_p14', [sampleResult({ id: 'res_p14', researchRequestId: 'rsch_p14', transferredCompanyId: linked.id, alreadyInProspects: true, serviceOpportunities: [{ service: 'crm', score: 80, confidence: 'high', recommendation: 'primary', reason: '', evidenceIds: [], signals: [{ key: 'booking_flow', label: 'b', state: 'positive', reason: 'r', evidenceIds: [], origin: 'check', weight: 1 }] }] })]);
    t.store.discovery.saveDetails({ jobId: 'rsch_p14', provider: 'fixture', filters: { familyId: null, website: 'has', contactRequired: false, language: 'any', size: 'any' }, searchQueries: [], searchesUsed: 0, plannedMaxSearches: 1, plannedMaxInspections: 1, createdAt: new Date(BASE).toISOString(), updatedAt: new Date(BASE).toISOString() });
    createOutreachPrepService(t.store, { now: t.now, maxRealGenerationsPerDay: 30 }).updatePreparation(pre.id, { angleKey: 'general_intro' });
    const fromSnapshot = readinessFromSnapshot(loadReadinessSnapshot(t.store));
    for (const c of t.store.companies.list()) expect(fromSnapshot.get(c.id), c.name).toEqual(loadReadiness(t.store, c));
  });
});

describe('read-only API', () => {
  it('list, single company and dashboard never change the database; 404 and 405 are distinct', async () => {
    const t = await setup();
    const c = await t.contacted('Api Clinic', 'api@api-clinic.example');
    t.fx.controls.addReply(t.store.outreach.listThreadSends()[0].gmailThreadId!, { shape: 'reply', at: BASE + 3_600_000 });
    await t.outreach.sync();
    const config = { ...loadConfig({}), testControls: false };
    const server = http.createServer(createApp({ config, provider: null, data: t.data, salesIntelligence: t.intelligence, reporting: t.reporting, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const before = fingerprint(t.store);
    const list = (await (await fetch(`${base}/api/sales-intelligence`)).json()) as SalesIntelligence;
    expect(list.insights[0]).toMatchObject({ companyId: c.id, action: { key: 'answer_reply' } });
    expect(list.diagnostics.openByStage.replied).toBe(1);
    expect(((await (await fetch(`${base}/api/sales-intelligence/${c.id}`)).json()) as { insight: SalesInsight }).insight.companyId).toBe(c.id);
    expect((await fetch(`${base}/api/dashboard?range=30d`)).status).toBe(200);
    expect((await fetch(`${base}/api/sales-intelligence/cmp_missing`)).status).toBe(404);
    expect((await fetch(`${base}/api/sales-intelligence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(405);
    expect(fingerprint(t.store)).toBe(before);
    expect(t.store.outreach.listSends()).toHaveLength(1);
  });

  it('the store works without the sales intelligence service (503)', async () => {
    const store = openStore(':memory:');
    stores.push(store);
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, data: createPersistenceServices(createStore(store.db)), fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    expect((await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sales-intelligence`)).status).toBe(503);
  });
});
