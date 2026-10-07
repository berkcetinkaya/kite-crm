// Phase 10: the dashboard API over a database built through the real Phase 6–9 code paths. Proves it
// is read-only (every table byte-identical after many calls) and makes no Gmail calls.
import { seedFirstContactDraft } from '../db/testFixtures';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Dashboard } from '../../src/domain/dashboard';
import type { NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createApp } from '../app';
import { createClock } from '../clock';
import { loadConfig } from '../config';
import { MIGRATIONS } from '../db/migrations';
import { openStore, type OpenedStore } from '../db/store';
import { createCustomerService } from '../customers/service';
import { createFollowUpPlanner } from '../followUp/service';
import { createGmailAdapter } from '../gmail/adapter';
import { createMemoryCredentialStore } from '../gmail/credentialStore';
import { createFixtureGmail, FIXTURE_AUTH_CODE } from '../gmail/fixture';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { createOutreachService } from '../outreach/service';
import { createPersistenceServices } from '../persistence/services';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createSalesService } from '../sales/service';
import { createReportingService } from './service';

const stores: OpenedStore[] = [];
const servers: http.Server[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  stores.splice(0).forEach((s) => s.close());
});

const BASE = Date.parse('2026-10-06T09:00:00.000Z');
const DAY = 86_400_000;
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

async function realisticWorld() {
  const clock = createClock(0, () => BASE);
  const now = () => clock.now();
  const store = openStore(':memory:');
  stores.push(store);
  const fx = createFixtureGmail({ redirectUri: '/cb', now: () => clock.now().getTime() });
  const gmailCalls: string[] = [];
  const api = fx.api as unknown as Record<string, unknown>;
  for (const k of Object.keys(api))
    if (typeof api[k] === 'function') {
      const fn = api[k] as (...a: unknown[]) => unknown;
      api[k] = (...a: unknown[]) => (gmailCalls.push(k), fn(...a));
    }
  const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials: createMemoryCredentialStore() });
  const { state } = gmail.beginAuthorization();
  await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
  const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
  const data = createPersistenceServices(store, { now, mailProvider: createFixtureMailProvider(), followUps: planner });
  const outreach = createOutreachService(store, gmail, { now, followUps: planner });
  const sales = createSalesService(store, { now, followUps: planner });
  const customers = createCustomerService(store, { now, followUps: planner });

  const ids: Record<string, string> = {};
  for (const [name, email] of [['Replied Co', 'a@replied.example'], ['Waiting Co', 'a@waiting.example']] as const) {
    const c = data.companies.create(companyInput(name, email));
    ids[name] = c.id;
    const d = seedFirstContactDraft(store, c.id, { service: 'meta_ads', language: 'tr', at: now().toISOString() });
    data.mail.approve(d.id, { selectedSubject: d.selectedSubject, body: d.body });
    await outreach.send({ draftId: d.id, companyId: c.id, contactId: c.contacts[0].id, idempotencyKey: `idem_p10_${name.replace(/\W/g, '')}_0001` });
  }
  const replied = store.outreach.listThreadSends().find((s) => s.recipientEmail === 'a@replied.example')!;
  fx.controls.addReply(replied.gmailThreadId!, { shape: 'reply' });
  await outreach.sync();
  sales.createMeeting(ids['Replied Co'], { scheduledAt: new Date(BASE + 2 * DAY).toISOString(), type: 'online', contactId: null, notes: '', outcome: '', nextActionLabel: null, nextActionDueAt: null });
  const { proposal } = sales.createProposal(
    ids['Replied Co'],
    { title: 'Paket', currency: 'TRY', contractMonths: 6, validUntil: new Date(BASE + 5 * DAY).toISOString(), notes: '', taxMode: 'excluded', taxRateBp: 2000, items: [{ service: 'meta_ads', description: '', billingType: 'monthly', unitAmountMinor: 2_500_000, quantity: 1 }] },
  );
  sales.transitionProposal(proposal.id, { to: 'ready' });
  sales.transitionProposal(proposal.id, { to: 'sent', sentAt: new Date(BASE).toISOString() });
  const client = data.companies.create(companyInput('Client Co', 'a@client.example', 'client'));
  const { customer } = customers.startOnboarding(client.id, { startDate: new Date(BASE).toISOString(), primaryContactId: null, commercialNotes: '', operationalNotes: '', sourceProposalId: null, services: [], onboardingItems: [], accessItems: [{ kind: 'ga4', label: '', notes: '' }], moveCompanyToClient: false });
  customers.setAccessStatus(customer.access[0].id, 'problem');
  // Ten days later: the proposal expired, the waiting company's follow-up is due.
  clock.setOffsetMs(10 * DAY);
  return { store, data, sales, customers, planner, gmailCalls, ids, reporting: createReportingService(store, { now, followUps: planner }), now };
}

const fingerprint = (s: OpenedStore) => {
  const tables = (s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  return JSON.stringify([s.db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all(), ...tables.map((t) => s.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())]);
};

async function serve(w: Awaited<ReturnType<typeof realisticWorld>> | null) {
  const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, data: w?.data ?? null, sales: w?.sales ?? null, customers: w?.customers ?? null, reporting: w?.reporting ?? null, fetchPage: fixtureFetcher }));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('dashboard API', () => {
  it('summarises real data and is strictly read-only (no row, schema or Gmail change)', async () => {
    const w = await realisticWorld();
    const base = await serve(w);
    const before = fingerprint(w.store);
    w.gmailCalls.length = 0;
    let last: Dashboard | null = null;
    for (const range of ['7d', '30d', '90d', 'month', '30d', '7d', '90d', 'month', '30d', '30d']) {
      const r = await fetch(`${base}/api/dashboard?range=${range}`);
      expect(r.status).toBe(200);
      last = (await r.json()) as Dashboard;
    }
    expect(fingerprint(w.store)).toBe(before);
    expect(w.gmailCalls).toEqual([]);
    expect(w.store.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);

    const d = last!;
    expect(d.range).toEqual({ key: '30d', from: '2026-09-17', to: '2026-10-16' });
    expect(d.sales.stageCounts).toMatchObject({ first_contact: 1, replied: 1, client: 1 });
    expect(d.sales.activity).toMatchObject({ sends: 2, replies: 1, proposalsSent: 1, newCustomers: 1, newCompanies: 3 });
    expect(d.proposals.awaitingDecision.byCurrency).toEqual([{ currency: 'TRY', oneTimeMinor: 0, monthlyMinor: 2_500_000, proposals: 1, taxMixed: false }]);
    const kinds = d.attention.map((a) => `${a.kind}:${a.severity}:${a.companyName}`);
    expect(kinds).toContain('access_problem:1:Client Co');
    expect(kinds).toContain('proposal_waiting:1:Replied Co'); // expired valid-until outranks waiting
    expect(kinds).toContain('meeting_no_outcome:2:Replied Co');
    expect(kinds.filter((k) => k.startsWith('proposal_waiting'))).toHaveLength(1);
    expect(d.attention.some((a) => a.kind === 'follow_up_due' && a.companyName === 'Waiting Co')).toBe(true);
    expect(d.followUps.due).toBe(1);
    expect(d.customers).toMatchObject({ blocked: 1, accessProblems: 1, statusCounts: { onboarding: 1 } });
    expect(d.momentum.map((m) => m.name).sort()).toEqual(['Replied Co', 'Waiting Co']);
    expect(d.momentum.find((m) => m.name === 'Replied Co')!.daysSinceReply).toBe(10);
  });

  it('refuses writes and unknown ranges; reports missing storage', async () => {
    const w = await realisticWorld();
    const base = await serve(w);
    expect((await fetch(`${base}/api/dashboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(405);
    expect((await fetch(`${base}/api/dashboard?range=365d`)).status).toBe(400);
    expect(((await (await fetch(`${base}/api/dashboard`)).json()) as Dashboard).range.key).toBe('30d');
    const none = await serve(null);
    expect((await fetch(`${none}/api/dashboard`)).status).toBe(503);
  });
});
