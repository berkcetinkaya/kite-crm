// Phase 8.2 / 8.3: meetings and proposals (service + HTTP). Fixture Gmail only where a real Phase 7
// follow-up plan is needed; no network, no email, no Anthropic.
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { proposalTotals, type MeetingInput, type ProposalInput } from '../../src/domain/sales';
import type { NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createApp } from '../app';
import { createClock } from '../clock';
import { loadConfig } from '../config';
import { openStore, type OpenedStore } from '../db/store';
import { createFollowUpPlanner } from '../followUp/service';
import { createGmailAdapter } from '../gmail/adapter';
import { createMemoryCredentialStore } from '../gmail/credentialStore';
import { createFixtureGmail, FIXTURE_AUTH_CODE } from '../gmail/fixture';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { createOutreachService } from '../outreach/service';
import { createPersistenceServices } from '../persistence/services';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createSalesService, SalesError } from './service';

const stores: OpenedStore[] = [];
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
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const companyInput = (over: Partial<NewCompanyInput> = {}): NewCompanyInput => ({
  name: 'Lyxa Klinik',
  website: null,
  sector: 'Güzellik Markası',
  city: 'İstanbul',
  country: 'Türkiye',
  source: 'manual',
  opportunities: [{ service: 'meta_ads', score: null, potential: null, reason: '' }],
  opportunityScore: null,
  status: 'replied',
  owner: 'Berk Çetinkaya',
  note: '',
  contacts: [{ fullName: 'Aytül Kaya', role: 'Kurucu', email: 'aytul@lyxa.example', phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' }],
  ...over,
});

const meetingInput = (over: Partial<MeetingInput> = {}): MeetingInput => ({
  scheduledAt: '2026-10-08T11:00:00.000Z',
  type: 'online',
  contactId: null,
  notes: 'İlk görüşme',
  outcome: '',
  nextActionLabel: null,
  nextActionDueAt: null,
  ...over,
});

const proposalInput = (over: Partial<ProposalInput> = {}): ProposalInput => ({
  title: 'Website + reklam paketi',
  currency: 'TRY',
  contractMonths: 6,
  validUntil: '2026-10-31T12:00:00.000Z',
  notes: '',
  taxMode: 'excluded',
  taxRateBp: 2000,
  items: [
    { service: 'website', description: 'Website yenileme', billingType: 'one_time', unitAmountMinor: 4_500_000, quantity: 1 },
    { service: 'meta_ads', description: 'Meta reklam yönetimi', billingType: 'monthly', unitAmountMinor: 1_500_000, quantity: 1 },
    { service: 'google_ads', description: 'Google Ads yönetimi', billingType: 'monthly', unitAmountMinor: 1_200_000, quantity: 1 },
    { service: 'creative', description: 'Aylık 8 görsel', billingType: 'monthly', unitAmountMinor: 250_000, quantity: 2 },
  ],
  ...over,
});

function setup(file = ':memory:') {
  const clock = createClock(0, () => Date.parse('2026-10-06T09:00:00.000Z'));
  const now = () => clock.now();
  const store = openStore(file);
  stores.push(store);
  const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
  const data = createPersistenceServices(store, { now, mailProvider: createFixtureMailProvider(), followUps: planner });
  const sales = createSalesService(store, { now, followUps: planner });
  const company = data.companies.create(companyInput());
  return { clock, store, planner, data, sales, company, get: () => store.companies.get(company.id)! };
}

async function expectSalesError(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SalesError);
    expect((e as SalesError).code).toBe(code);
    return e as SalesError;
  }
  throw new Error(`expected ${code}`);
}

describe('meetings', () => {
  it('planning a meeting records it in the history and never changes the stage', () => {
    const t = setup();
    const r = t.sales.createMeeting(t.company.id, meetingInput({ contactId: t.company.contacts[0].id }));
    expect(r.meeting).toMatchObject({ status: 'planned', type: 'online', contactName: 'Aytül Kaya', contactEmail: 'aytul@lyxa.example' });
    expect(r.company.status).toBe('replied');
    expect(r.company.history[0]).toMatchObject({ type: 'meeting' });
    expect(r.company.history[0].description).toMatch(/^Görüşme planlandı: .* · Online · Aytül Kaya$/);
  });

  it('moves the stage only when explicitly asked (as a normal status change)', () => {
    const t = setup();
    const r = t.sales.createMeeting(t.company.id, meetingInput(), { moveCompanyTo: 'meeting' });
    expect(r.company.status).toBe('meeting');
    expect(r.company.history.some((h) => h.type === 'status_changed' && h.description === 'Durum Yanıt Geldi → Görüşme olarak değiştirildi')).toBe(true);
  });

  it('refuses a contact that is not on the company', async () => {
    const t = setup();
    await expectSalesError(() => t.sales.createMeeting(t.company.id, meetingInput({ contactId: 'ct_unknown_1' })), 'sales_contact_missing');
    expect(t.store.sales.listMeetings()).toEqual([]);
  });

  it('completing records outcome and next action; the company next action and stage change only when asked', async () => {
    const t = setup();
    const { meeting } = t.sales.createMeeting(t.company.id, meetingInput());
    const done = t.sales.completeMeeting(meeting.id, {
      outcome: 'Teklif istediler',
      notes: 'Website ve reklam',
      nextActionLabel: 'Teklif hazırla',
      nextActionDueAt: '2026-10-09T09:00:00.000Z',
      setCompanyNextAction: true,
      moveCompanyTo: 'proposal',
    });
    expect(done.meeting).toMatchObject({ status: 'completed', outcome: 'Teklif istediler', completedAt: '2026-10-06T09:00:00.000Z' });
    expect(done.company.nextAction).toEqual({ label: 'Teklif hazırla', dueAt: '2026-10-09T09:00:00.000Z' });
    expect(done.company.status).toBe('proposal');
    expect(done.company.history.some((h) => h.type === 'meeting' && h.description.includes('Sonuç: Teklif istediler'))).toBe(true);
    await expectSalesError(() => t.sales.completeMeeting(meeting.id, { outcome: '', notes: '', nextActionLabel: null, nextActionDueAt: null, setCompanyNextAction: false }), 'sales_invalid_transition');

    const t2 = setup();
    const m2 = t2.sales.createMeeting(t2.company.id, meetingInput()).meeting;
    const r2 = t2.sales.completeMeeting(m2.id, { outcome: 'Olumlu', notes: '', nextActionLabel: 'Ara', nextActionDueAt: null, setCompanyNextAction: false });
    expect(r2.company.status).toBe('replied'); // a completed meeting never makes a customer
    expect(r2.company.nextAction).toBeNull();
  });

  it('edits and cancels a planned meeting', async () => {
    const t = setup();
    const { meeting } = t.sales.createMeeting(t.company.id, meetingInput());
    const edited = t.sales.updateMeeting(meeting.id, meetingInput({ type: 'phone', notes: 'Telefonla' }));
    expect(edited.meeting).toMatchObject({ type: 'phone', notes: 'Telefonla', createdAt: meeting.createdAt });
    const cancelled = t.sales.cancelMeeting(meeting.id);
    expect(cancelled.meeting.status).toBe('cancelled');
    expect(cancelled.company.history[0].description).toMatch(/^Görüşme iptal edildi/);
    await expectSalesError(() => t.sales.cancelMeeting(meeting.id), 'sales_invalid_transition');
  });
});

describe('proposals', () => {
  it('a proposal holds several services; one-time and monthly totals stay separate', () => {
    const t = setup();
    const { proposal, company } = t.sales.createProposal(t.company.id, proposalInput());
    expect(proposal).toMatchObject({ status: 'draft', currency: 'TRY', taxMode: 'excluded', taxRateBp: 2000, contractMonths: 6 });
    expect(proposal.items.map((i) => [i.position, i.service, i.billingType])).toEqual([
      [0, 'website', 'one_time'],
      [1, 'meta_ads', 'monthly'],
      [2, 'google_ads', 'monthly'],
      [3, 'creative', 'monthly'],
    ]);
    expect(proposalTotals(proposal.items)).toEqual({ oneTimeMinor: 4_500_000, monthlyMinor: 1_500_000 + 1_200_000 + 500_000 });
    expect(company.history[0].description).toBe('Teklif oluşturuldu: “Website + reklam paketi” · tek seferlik ₺45.000,00, aylık ₺32.000,00');
    expect(company.status).toBe('replied');
  });

  it('never adds an opportunity automatically; only the explicitly listed missing services', () => {
    const t = setup();
    const r1 = t.sales.createProposal(t.company.id, proposalInput());
    expect(r1.company.opportunities.map((o) => o.service)).toEqual(['meta_ads']);
    const r2 = t.sales.updateProposal(r1.proposal.id, proposalInput(), { addOpportunities: ['website', 'meta_ads', 'website'] });
    expect(r2.company.opportunities.map((o) => o.service)).toEqual(['meta_ads', 'website']);
  });

  it('full lifecycle: edit → ready → sent (date) → accepted; stage moves only when requested', () => {
    const t = setup();
    const { proposal } = t.sales.createProposal(t.company.id, proposalInput({ items: [] }));
    const edited = t.sales.updateProposal(proposal.id, proposalInput({ title: 'Revize paket' }));
    expect(edited.proposal.items).toHaveLength(4);
    expect(t.sales.transitionProposal(proposal.id, { to: 'ready' }).proposal.status).toBe('ready');
    const sent = t.sales.transitionProposal(proposal.id, { to: 'sent', sentAt: '2026-10-05T15:00:00.000Z' });
    expect(sent.proposal).toMatchObject({ status: 'sent', sentAt: '2026-10-05T15:00:00.000Z' });
    expect(sent.company.status).toBe('replied'); // not moved without asking
    const accepted = t.sales.transitionProposal(proposal.id, { to: 'accepted', moveCompanyTo: 'client' });
    expect(accepted.proposal).toMatchObject({ status: 'accepted', decidedAt: '2026-10-06T09:00:00.000Z', sentAt: '2026-10-05T15:00:00.000Z' });
    expect(accepted.company.status).toBe('client');
    const descriptions = accepted.company.history.filter((h) => h.type === 'proposal').map((h) => h.description);
    expect(descriptions).toContain('Teklif “Revize paket”: Gönderilmeye Hazır → Gönderildi · gönderim: 5 Eki 2026');
    expect(descriptions).toContain('Teklif “Revize paket”: Gönderildi → Kabul Edildi');
  });

  it('sent proposals are locked; reopening to Taslak unlocks and clears the send', async () => {
    const t = setup();
    const { proposal } = t.sales.createProposal(t.company.id, proposalInput());
    t.sales.transitionProposal(proposal.id, { to: 'ready' });
    t.sales.transitionProposal(proposal.id, { to: 'sent' });
    await expectSalesError(() => t.sales.updateProposal(proposal.id, proposalInput({ title: 'X' })), 'sales_locked');
    const reopened = t.sales.transitionProposal(proposal.id, { to: 'draft' });
    expect(reopened.proposal).toMatchObject({ status: 'draft', sentAt: null, decidedAt: null });
    expect(t.sales.updateProposal(proposal.id, proposalInput({ title: 'X' })).proposal.title).toBe('X');
  });

  it('rejection needs a reason; can move to Kaybedildi; decisions can be reopened', async () => {
    const t = setup();
    const { proposal } = t.sales.createProposal(t.company.id, proposalInput());
    t.sales.transitionProposal(proposal.id, { to: 'ready' });
    t.sales.transitionProposal(proposal.id, { to: 'sent', moveCompanyTo: 'awaiting_decision' });
    expect(t.get().status).toBe('awaiting_decision');
    await expectSalesError(() => t.sales.transitionProposal(proposal.id, { to: 'rejected', lossReason: '  ' }), 'sales_invalid');
    const rejected = t.sales.transitionProposal(proposal.id, { to: 'rejected', lossReason: 'Bütçe yetersiz', moveCompanyTo: 'lost' });
    expect(rejected.proposal).toMatchObject({ status: 'rejected', lossReason: 'Bütçe yetersiz' });
    expect(rejected.company.status).toBe('lost');
    const reopened = t.sales.transitionProposal(proposal.id, { to: 'sent', moveCompanyTo: 'awaiting_decision' });
    expect(reopened.proposal).toMatchObject({ status: 'sent', lossReason: null, decidedAt: null });
    expect(reopened.proposal.sentAt).not.toBeNull();
    expect(reopened.company.status).toBe('awaiting_decision');
    expect(t.sales.transitionProposal(proposal.id, { to: 'expired' }).proposal.status).toBe('expired');
  });

  it('refuses transitions that skip a step and marking ready without items', async () => {
    const t = setup();
    const { proposal } = t.sales.createProposal(t.company.id, proposalInput({ items: [] }));
    await expectSalesError(() => t.sales.transitionProposal(proposal.id, { to: 'ready' }), 'sales_invalid');
    await expectSalesError(() => t.sales.transitionProposal(proposal.id, { to: 'sent' }), 'sales_invalid_transition');
    await expectSalesError(() => t.sales.transitionProposal(proposal.id, { to: 'accepted' }), 'sales_invalid_transition');
    await expectSalesError(() => t.sales.transitionProposal('prp_missing_1', { to: 'ready' }), 'sales_not_found');
  });

  it('refuses a future send date and a decision dated before the send', async () => {
    const t = setup();
    const { proposal } = t.sales.createProposal(t.company.id, proposalInput());
    t.sales.transitionProposal(proposal.id, { to: 'ready' });
    await expectSalesError(() => t.sales.transitionProposal(proposal.id, { to: 'sent', sentAt: '2026-10-09T12:00:00.000Z' }), 'sales_invalid');
    expect(t.store.sales.getProposal(proposal.id)!.status).toBe('ready');
    t.sales.transitionProposal(proposal.id, { to: 'sent', sentAt: '2026-10-05T12:00:00.000Z' });
    await expectSalesError(() => t.sales.transitionProposal(proposal.id, { to: 'accepted', decidedAt: '2026-10-04T12:00:00.000Z' }), 'sales_invalid');
    await expectSalesError(() => t.sales.transitionProposal(proposal.id, { to: 'rejected', lossReason: 'x', decidedAt: '2026-10-20T12:00:00.000Z' }), 'sales_invalid');
    expect(t.sales.transitionProposal(proposal.id, { to: 'accepted', decidedAt: '2026-10-05T18:00:00.000Z' }).proposal.status).toBe('accepted');
  });

  it('sales actions never change lastContactAt', () => {
    const t = setup();
    const before = t.get().lastContactAt;
    const { proposal } = t.sales.createProposal(t.company.id, proposalInput());
    t.sales.transitionProposal(proposal.id, { to: 'ready' });
    t.sales.transitionProposal(proposal.id, { to: 'sent', moveCompanyTo: 'awaiting_decision' });
    const { meeting } = t.sales.createMeeting(t.company.id, meetingInput());
    t.sales.completeMeeting(meeting.id, { outcome: 'ok', notes: '', nextActionLabel: null, nextActionDueAt: null, setCompanyNextAction: false });
    expect(t.get().lastContactAt).toBe(before);
  });

  it('survives a restart', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'kite-p8s-'));
    dirs.push(d);
    const file = path.join(d, 'kite.db');
    const t = setup(file);
    const { proposal } = t.sales.createProposal(t.company.id, proposalInput());
    t.sales.createMeeting(t.company.id, meetingInput());
    t.store.close();
    const again = openStore(file);
    stores.push(again);
    expect(again.sales.getProposal(proposal.id)).toEqual(proposal);
    expect(again.sales.listMeetings()).toHaveLength(1);
  });
});

describe('Phase 7 compatibility', () => {
  it('an explicit move past İlk Temas applies the existing follow-up rule; without a move the plan is untouched', async () => {
    const clock = createClock(0, () => Date.parse('2026-10-06T09:00:00.000Z'));
    const now = () => clock.now();
    const store = openStore(':memory:');
    stores.push(store);
    const fx = createFixtureGmail({ redirectUri: '/cb', now: () => clock.now().getTime() });
    const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials: createMemoryCredentialStore() });
    const { state } = gmail.beginAuthorization();
    await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
    const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
    const data = createPersistenceServices(store, { now, mailProvider: createFixtureMailProvider(), followUps: planner });
    const outreach = createOutreachService(store, gmail, { now, followUps: planner });
    const sales = createSalesService(store, { now, followUps: planner });
    const c = data.companies.create(companyInput({ status: 'researched' }));
    const d = await data.mail.generate({ companyId: c.id, service: 'meta_ads', language: 'tr', contactId: null, preserve: null });
    data.mail.approve(d.id, { selectedSubject: d.selectedSubject, body: d.body });
    await outreach.send({ draftId: d.id, companyId: c.id, contactId: c.contacts[0].id, idempotencyKey: 'idem_p8_compat_000001' });
    const seq = () => store.followUps.listByCompany(c.id)[0];
    expect(seq().status).toBe('active');
    sales.createMeeting(c.id, meetingInput());
    expect(seq().status).toBe('active');
    sales.createMeeting(c.id, meetingInput(), { moveCompanyTo: 'meeting' });
    expect(seq()).toMatchObject({ status: 'stopped', stoppedBy: 'system' });
    expect(store.outreach.listSends()).toHaveLength(1);
  });
});

describe('HTTP', () => {
  async function start() {
    const t = setup();
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, data: t.data, sales: t.sales, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    return { t, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }
  const send = (base: string, method: string, p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('creates and lists through the API, refuses cross-site requests and invalid input', async () => {
    const { t, base } = await start();
    const created = await send(base, 'POST', '/api/sales/proposals', { companyId: t.company.id, proposal: proposalInput(), addOpportunities: ['website'] });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { proposal: { id: string; items: unknown[] }; company: { opportunities: { service: string }[] } };
    expect(body.proposal.items).toHaveLength(4);
    expect(body.company.opportunities.map((o) => o.service)).toEqual(['meta_ads', 'website']);
    const list = (await (await fetch(`${base}/api/sales`)).json()) as { proposals: unknown[]; meetings: unknown[] };
    expect(list).toMatchObject({ proposals: [expect.anything()], meetings: [] });

    expect((await send(base, 'POST', '/api/sales/meetings', { companyId: t.company.id, meeting: meetingInput() }, { origin: 'https://evil.example' })).status).toBe(403);
    const bad = (p: Partial<ProposalInput>) => send(base, 'POST', '/api/sales/proposals', { companyId: t.company.id, proposal: proposalInput(p) });
    expect((await bad({ currency: 'BTC' as 'TRY' })).status).toBe(400);
    expect((await bad({ items: [{ ...proposalInput().items[0], unitAmountMinor: -5 }] })).status).toBe(400);
    expect((await bad({ items: [{ ...proposalInput().items[0], unitAmountMinor: 12.5 }] })).status).toBe(400);
    expect((await bad({ items: Array.from({ length: 21 }, () => proposalInput().items[0]) })).status).toBe(400);
    expect((await bad({ contractMonths: 0 })).status).toBe(400);
    expect((await bad({ taxRateBp: 10_001 })).status).toBe(400);
    const wrong = await send(base, 'POST', `/api/sales/proposals/${body.proposal.id}/status`, { to: 'accepted' });
    expect(wrong.status).toBe(409);
    expect(((await wrong.json()) as { error: { message: string } }).error.message).toMatch(/geçirilemez/);
    expect(t.store.sales.listProposals()).toHaveLength(1);
  });
});
