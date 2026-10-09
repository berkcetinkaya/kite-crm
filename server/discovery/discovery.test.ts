// Phase 12: schema v7, run limits / filters through the real discover endpoint (fixture provider),
// reversible review, live duplicates, idempotent per-candidate conversion, legacy transfer
// compatibility and re-research versions. No network, no paid provider, no email.
import { asSchemaVersion } from '../db/testFixtures';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DISCOVERY_FILTERS, type DiscoveryFilters } from '../../src/domain/prospecting';
import type { ResearchCriteria, ResearchRequest, ResearchResult } from '../../src/domain/research';
import type { AnalyzeEvent, DiscoverResponse } from '../../src/domain/researchApi';
import type { NewCompanyInput } from '../../src/state/companies/companyCommands';
import { resultPatchFromAnalysis } from '../../src/state/research/realResearchRunner';
import { createApp } from '../app';
import { createClock, type Clock } from '../clock';
import { loadConfig } from '../config';
import { MIGRATIONS, runMigrations } from '../db/migrations';
import { openDatabase, type Db } from '../db/sqlite';
import { createStore, openStore, type OpenedStore } from '../db/store';
import { createPersistenceServices } from '../persistence/services';
import { analyzeBatch } from '../research/analysis';
import { copyrightYear } from '../web/extract';
import { createFixtureProvider, fixtureFetcher } from '../research/fixtureProvider';
import type { ResearchProviderAdapter } from '../research/provider';
import { createTaskService } from '../tasks/service';
import { createDiscoveryService } from './service';

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

const BASE = Date.parse('2026-10-07T09:00:00.000Z');
const DAY = 86_400_000;
const criteria: ResearchCriteria = { service: 'website', sector: 'Diş Kliniği', sectorId: 'dental_clinic', country: 'United Arab Emirates', countryCode: 'AE', city: 'Dubai', companyCount: 10, criteria: '', exclusions: '' };
const companyInput = (name: string, over: Partial<NewCompanyInput> = {}): NewCompanyInput => ({
  name,
  website: null,
  sector: 'Diş Kliniği',
  city: 'Dubai',
  country: 'United Arab Emirates',
  source: 'manual',
  opportunities: [],
  opportunityScore: null,
  status: 'researched',
  owner: 'Berk Çetinkaya',
  note: '',
  contacts: [],
  ...over,
});

function job(id: string, provider: ResearchRequest['provider'] = 'fixture'): ResearchRequest {
  const at = new Date(BASE).toISOString();
  return { ...criteria, id, name: `Dubai Diş Kliniği • Website (${id})`, status: 'running', mode: 'real', isDemo: false, provider, createdAt: at, updatedAt: at, startedAt: at, completedAt: null, resultCount: 0, progress: null, errorMessage: null, cancelled: false };
}

function setup(opts: { provider?: ResearchProviderAdapter; maxRealRunsPerDay?: number; file?: string; allowFictionalConversion?: boolean } = {}) {
  const clock: Clock = createClock(0, () => BASE);
  const now = () => clock.now();
  const store = openStore(opts.file ?? ':memory:');
  stores.push(store);
  const provider = opts.provider ?? createFixtureProvider();
  // These tests run the offline fixture provider on a throwaway database, so they opt in to converting
  // its (fictional) candidates; the running server never does (Phase 14 demo safety).
  const allowFictionalConversion = opts.allowFictionalConversion ?? true;
  const data = createPersistenceServices(store, { now, allowFictionalConversion });
  const discovery = createDiscoveryService(store, { now, provider, fetchPage: fixtureFetcher, maxExtraPages: 3, maxRealRunsPerDay: opts.maxRealRunsPerDay ?? 10, allowFictionalConversion });
  const tasks = createTaskService(store, { now });
  return { clock, store, data, discovery, provider, tasks };
}

async function serve(t: ReturnType<typeof setup>) {
  const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: t.provider, data: t.data, discovery: t.discovery, fetchPage: fixtureFetcher }));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { base, send };
}

/** Runs one fixture job end to end like the browser runner: discover (HTTP) → analyze → save results. */
async function runJob(t: ReturnType<typeof setup>, api: Awaited<ReturnType<typeof serve>>, id: string, filters: DiscoveryFilters = DEFAULT_DISCOVERY_FILTERS) {
  t.data.research.saveJob(job(id, t.provider.id));
  const res = await api.send('POST', '/api/research/discover', { criteria, knownHosts: [], jobId: id, filters });
  expect(res.status).toBe(200);
  const disc = (await res.json()) as DiscoverResponse;
  const created = new Date(BASE).toISOString();
  const results: ResearchResult[] = disc.candidates.map((c, i) => ({
    id: `res_${id}_${i}`,
    researchRequestId: id,
    companyName: c.name,
    website: c.website || null,
    sector: criteria.sector,
    city: c.city,
    country: 'United Arab Emirates',
    source: 'web',
    service: criteria.service,
    opportunityScore: null,
    reason: c.sectorFit,
    companySize: null,
    confidence: c.confidence,
    selected: false,
    alreadyInProspects: false,
    transferredCompanyId: null,
    researchStatus: 'discovered',
    createdAt: created,
    evidence: c.evidence,
    discovery: { sectorFit: c.sectorFit, profileFit: c.profileFit, confidence: c.confidence },
  }));
  const events: AnalyzeEvent[] = [];
  await analyzeBatch({ provider: t.provider, fetchPage: fixtureFetcher, maxExtraPages: 3 }, criteria, disc.candidates, (e) => events.push(e));
  const byCandidate = new Map(disc.candidates.map((c, i) => [c.id, results[i]]));
  for (const e of events) {
    if (e.type === 'analyzed') Object.assign(byCandidate.get(e.candidateId)!, resultPatchFromAnalysis(e.result));
    if (e.type === 'failed') Object.assign(byCandidate.get(e.candidateId)!, { researchStatus: 'failed', analysisError: e.message });
  }
  t.data.research.saveResults(id, results);
  t.data.research.saveJob({ ...job(id, t.provider.id), status: 'completed', resultCount: results.length });
  return { disc, results, byName: (n: string) => results.find((r) => r.companyName === n)! };
}

const fingerprint = (db: Db, tables: string[]) => Object.fromEntries(tables.map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())]));

describe('schema v7', () => {
  it('fresh install reaches v7 with the three prospecting tables', () => {
    const s = openStore(':memory:');
    stores.push(s);
    expect(s.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    expect(MIGRATIONS.find((m) => m.version === 7)).toMatchObject({ version: 7, name: 'prospecting' });
    expect(MIGRATIONS.at(-1)!.foreignKeysOff).toBeUndefined();
    for (const t of ['research_job_details', 'candidate_reviews', 'research_result_versions']) expect(s.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(t)).toEqual({ n: 1 });
  });

  it('upgrades a Phase 11 database (research jobs + results + transfer + tasks) without changing any row', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kite-p12-'));
    dirs.push(dir);
    const file = path.join(dir, 'kite.db');
    const db = openDatabase(file);
    dbs.push(db);
    runMigrations(db, MIGRATIONS.filter((m) => m.version <= 6));
    const store = asSchemaVersion(createStore(db), 6);
    const provider = createFixtureProvider();
    const data = createPersistenceServices(store, { now: () => new Date(BASE), allowFictionalConversion: true });
    const t = { store, data, provider, discovery: null, clock: createClock(0, () => BASE), tasks: createTaskService(store, { now: () => new Date(BASE) }) } as unknown as ReturnType<typeof setup>;
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider, data, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const api = { base, send: (m: string, p: string, b?: unknown) => fetch(`${base}${p}`, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }) };
    const { byName } = await runJob(t, api, 'rsch_old');
    // A Phase 4 transfer link (the app always migrates first, so the link is written directly here).
    const linked = data.companies.create(companyInput('Aurora Dental Studio', { website: 'https://aurora-dental.example/' }));
    data.research.saveResults('rsch_old', [{ ...byName('Aurora Dental Studio'), transferredCompanyId: linked.id, alreadyInProspects: true }]);
    t.tasks.create({ title: 'Eski görev', notes: '', priority: 'normal', dueAt: null, dueHasTime: false, owner: null, companyId: null, customerId: null });
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toHaveLength(23);
    const before = fingerprint(db, tables);
    expect(JSON.parse(before.research_results).length).toBeGreaterThan(2);
    expect(JSON.parse(before.tasks)).toHaveLength(1);
    db.close();
    const s = openStore(file);
    stores.push(s);
    expect(s.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    expect(fingerprint(s.db, tables)).toEqual(before);
    for (const n of ['research_job_details', 'candidate_reviews', 'research_result_versions']) expect(s.db.prepare(`SELECT COUNT(*) n FROM ${n}`).get()).toEqual({ n: 0 });
    expect(s.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(s.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(runMigrations(s.db)).toEqual({ applied: [], version: MIGRATIONS.at(-1)!.version });
  });

  it('the database refuses Uygun Değil without a reason', () => {
    const t = setup();
    t.data.research.saveJob(job('rsch_x'));
    t.data.research.saveResults('rsch_x', [{ id: 'res_x', researchRequestId: 'rsch_x', companyName: 'X', website: null, sector: 'Diş Kliniği', city: null, country: 'AE', source: 'web', service: 'website', opportunityScore: null, reason: '', companySize: null, confidence: 'low', selected: false, alreadyInProspects: false, transferredCompanyId: null, researchStatus: 'discovered', createdAt: new Date(BASE).toISOString() }]);
    expect(() => t.store.db.prepare("INSERT INTO candidate_reviews (result_id, status, updated_at) VALUES ('res_x', 'not_fit', 'x')").run()).toThrow(/CHECK/);
    expect(() => t.store.db.prepare("INSERT INTO candidate_reviews (result_id, status, reject_reason, updated_at) VALUES ('res_x', 'not_fit', '  ', 'x')").run()).toThrow(/CHECK/);
  });
});

describe('discovery runs: filters, details, daily cap', () => {
  it('records filters, queries and usage; fixture runs never count against the real-run cap', async () => {
    const t = setup({ maxRealRunsPerDay: 1 });
    const api = await serve(t);
    await runJob(t, api, 'rsch_f1', { ...DEFAULT_DISCOVERY_FILTERS, familyId: 'health', language: 'en' });
    await runJob(t, api, 'rsch_f2');
    const d = t.store.discovery.getDetails('rsch_f1')!;
    expect(d).toMatchObject({ provider: 'fixture', filters: { familyId: 'health', language: 'en', website: 'has' }, searchesUsed: 3, plannedMaxInspections: 10 });
    expect(d.searchQueries).toEqual(['Diş Kliniği Dubai', 'best Diş Kliniği Dubai', 'Diş Kliniği Dubai contact']);
    expect(t.discovery.realRuns()).toEqual({ today: 0, limit: 1 });
    const status = (await (await fetch(`${api.base}/api/research/status`)).json()) as { realRuns: { today: number; limit: number }; maxSearchesPerDiscovery: number };
    expect(status.realRuns).toEqual({ today: 0, limit: 1 });
    expect(status.maxSearchesPerDiscovery).toBeGreaterThan(0);
  });

  it('real provider: counted per İstanbul day, retries of the same job are not double-counted, the cap returns 429, next day resets', async () => {
    const fake: ResearchProviderAdapter = { ...createFixtureProvider(), id: 'anthropic' };
    const t = setup({ provider: fake, maxRealRunsPerDay: 2 });
    const api = await serve(t);
    await runJob(t, api, 'rsch_r1');
    expect((await api.send('POST', '/api/research/discover', { criteria, knownHosts: [], jobId: 'rsch_r1' })).status).toBe(200); // same job again
    await runJob(t, api, 'rsch_r2');
    expect(t.discovery.realRuns()).toEqual({ today: 2, limit: 2 });
    t.data.research.saveJob(job('rsch_r3', 'anthropic'));
    const capped = await api.send('POST', '/api/research/discover', { criteria, knownHosts: [], jobId: 'rsch_r3' });
    expect(capped.status).toBe(429);
    expect(((await capped.json()) as { error: { code: string } }).error.code).toBe('daily_limit');
    expect((await api.send('POST', '/api/research/discover', { criteria, knownHosts: [] })).status).toBe(400); // real runs must name their job
    t.clock.setOffsetMs(DAY);
    expect((await api.send('POST', '/api/research/discover', { criteria, knownHosts: [], jobId: 'rsch_r3' })).status).toBe(200);
  });

  it('website rule: "has" (default) rejects a company without a website; "any" keeps it (search evidence only); "none" rejects companies with a website', async () => {
    const t = setup();
    const api = await serve(t);
    const has = await runJob(t, api, 'rsch_w1');
    expect(has.results.map((r) => r.companyName)).not.toContain('Lumen Dental Atelier');
    const any = await runJob(t, api, 'rsch_w2', { ...DEFAULT_DISCOVERY_FILTERS, website: 'any' });
    const lumen = any.byName('Lumen Dental Atelier');
    expect(lumen).toMatchObject({ website: null, researchStatus: 'analyzed' });
    expect(lumen.analysis!.warnings[0]).toMatch(/resmi websitesi yok/);
    const view = t.discovery.job('rsch_w2').candidates.find((c) => c.result.companyName === 'Lumen Dental Atelier')!;
    expect(view.confidence.level).toBe('low');
    const none = await runJob(t, api, 'rsch_w3', { ...DEFAULT_DISCOVERY_FILTERS, website: 'none' });
    // A candidate whose only suggested "website" is a directory listing counts as having no website.
    expect(none.results.map((r) => [r.companyName, r.website])).toEqual([['Directory Listing Clinic', null], ['Lumen Dental Atelier', null]]);
    expect(any.byName('Directory Listing Clinic').website).toBeNull();
    expect(none.disc.rejected.some((x) => /websitesi var/.test(x.reason))).toBe(true);
  });

  it('website observations: declared language versions and the latest visible copyright year', async () => {
    const t = setup();
    const api = await serve(t);
    const { byName } = await runJob(t, api, 'rsch_obs');
    expect(byName('Aurora Dental Studio').technical).toMatchObject({ languageVersions: 2, copyrightYear: null });
    expect(byName('Harbor Smile').technical).toMatchObject({ languageVersions: 0, copyrightYear: 2017 });
    expect(copyrightYear('Copyright 2015-2021 Acme · © 2019')).toBe(2021);
    expect(copyrightYear('Founded 1998')).toBeNull();
  });
});

describe('review, duplicates and conversion', () => {
  it('review is reversible until conversion; Uygun Değil needs a reason (kept when reversed); browser saves never overwrite it', async () => {
    const t = setup();
    const api = await serve(t);
    const { byName, results } = await runJob(t, api, 'rsch_rv');
    const id = byName('Aurora Dental Studio').id;
    const put = (review: unknown) => api.send('PUT', `/api/discovery/candidates/${id}/review`, { review });
    expect((await put({ status: 'not_fit' })).status).toBe(400);
    expect((await put({ status: 'not_fit', rejectReason: 'Zincir klinik' })).status).toBe(200);
    expect((await put({ status: 'unreviewed' })).status).toBe(200);
    expect((await put({ status: 'fit', notes: 'Güçlü aday', services: ['website', 'seo'] })).status).toBe(200);
    const review = t.store.discovery.getReview(id)!;
    expect(review).toMatchObject({ status: 'fit', rejectReason: 'Zincir klinik', notes: 'Güçlü aday', services: ['website', 'seo'] });
    // The browser's research save (PUT /results) cannot touch reviewer decisions.
    t.data.research.saveResults('rsch_rv', results.map((r) => ({ ...r, reason: 'changed by browser' })));
    expect(t.store.discovery.getReview(id)).toEqual(review);
    expect((await put({ notes: 'password: hunter2' })).status).toBe(400);
    expect((await api.send('PUT', `/api/discovery/candidates/${id}/review`, { review: { status: 'fit' } }, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('contacts: matches of research findings keep their provenance; anything else becomes Manuel', async () => {
    const t = setup();
    const api = await serve(t);
    const { byName } = await runJob(t, api, 'rsch_ct');
    const r = byName('Aurora Dental Studio');
    const view = t.discovery.candidate(r.id);
    expect(view.defaultContacts.map((c) => [c.fullName, c.provenance])).toEqual([['Dr. Lena Hart', 'website'], ['Genel iletişim', 'website']]);
    const updated = t.discovery.updateReview(r.id, { contacts: [{ ...view.defaultContacts[0], role: 'Klinik Direktörü' }, { fullName: 'Ece Kaya', role: 'Pazarlama', email: 'ece@aurora-dental.example', phone: null, provenance: 'website', evidenceIds: ['w1'] }] });
    expect(updated.review.contacts!.map((c) => [c.fullName, c.role, c.provenance])).toEqual([['Dr. Lena Hart', 'Klinik Direktörü', 'website'], ['Ece Kaya', 'Pazarlama', 'manual']]);
  });

  it('hard duplicates block; probable ones need "Farklı şirket"; conversion creates opportunities only for the services sent', async () => {
    const t = setup();
    const api = await serve(t);
    t.data.companies.create(companyInput('Harbor Smile', { country: 'AE' })); // same name + country → probable
    t.data.companies.create(companyInput('Closed Clinic Group', { website: 'https://closed-clinic.example/' })); // same host → hard
    const { byName } = await runJob(t, api, 'rsch_cv');
    const aurora = byName('Aurora Dental Studio');
    const harbor = byName('Harbor Smile');
    const view = t.discovery.job('rsch_cv');
    expect(view.candidates.find((c) => c.result.id === harbor.id)!.duplicates).toMatchObject({ level: 'probable', needsConfirmation: true });
    const closed = view.candidates.find((c) => c.result.companyName === 'Closed Clinic')!;
    expect(closed.duplicates).toMatchObject({ level: 'hard', blocksConversion: true });

    t.discovery.updateReview(aurora.id, { sector: 'Estetik Diş Kliniği', notes: 'Kickoff sonrası ara', status: 'fit' });
    const h0 = t.store.companies.list().length;
    const res = await api.send('POST', '/api/discovery/convert', { items: [{ resultId: aurora.id, services: ['website', 'seo'] }, { resultId: harbor.id, services: ['website'] }, { resultId: closed.result.id, services: ['website'] }] });
    const out = ((await res.json()) as { results: { resultId: string; status: string; ok: boolean; companyId: string | null }[] }).results;
    expect(out.map((o) => o.status)).toEqual(['converted', 'confirmation_required', 'duplicate']);
    expect(t.store.companies.list().length).toBe(h0 + 1);
    const company = t.store.companies.get(out[0].companyId!)!;
    expect(company).toMatchObject({ status: 'found', sector: 'Estetik Diş Kliniği', source: 'research' });
    expect(company.opportunities.map((o) => o.service)).toEqual(['website', 'seo']);
    expect(company.contacts.map((c) => c.fullName)).toEqual(['Dr. Lena Hart', 'Genel iletişim']);
    expect(company.notes.map((n) => n.content)).toEqual(['Kickoff sonrası ara']);
    // The usual creation entries (Phase 2/4): created (with the discovery origin), contacts, note.
    expect(company.history.map((h) => h.type).sort()).toEqual(['contact_added', 'contact_added', 'created', 'note_added']);
    expect(company.history.find((h) => h.type === 'created')!.description).toMatch(/test araştırması \(fixture\).*Araştırma: Dubai Diş Kliniği/);
    expect(t.store.research.getResult(aurora.id)!.transferredCompanyId).toBe(company.id);

    // Idempotent: converting again never creates a second company.
    const again = ((await (await api.send('POST', '/api/discovery/convert', { items: [{ resultId: aurora.id, services: ['crm'] }] })).json()) as { results: { status: string; companyId: string }[] }).results[0];
    expect(again).toMatchObject({ status: 'already_converted', companyId: company.id });
    expect(t.store.companies.list().length).toBe(h0 + 1);
    // Converted candidates are read-only.
    expect((await api.send('PUT', `/api/discovery/candidates/${aurora.id}/review`, { review: { status: 'not_fit', rejectReason: 'x' } })).status).toBe(409);

    // "Farklı şirket" for the probable match, then conversion succeeds.
    const matchKey = view.candidates.find((c) => c.result.id === harbor.id)!.duplicates.matches[0].key;
    expect((await api.send('POST', `/api/discovery/candidates/${harbor.id}/duplicate-ack`, { key: 'company:cmp_nope', confirmed: true })).status).toBe(400);
    expect((await api.send('POST', `/api/discovery/candidates/${harbor.id}/duplicate-ack`, { key: matchKey, confirmed: true })).status).toBe(200);
    const harborOut = t.discovery.convert([{ resultId: harbor.id, services: [] }])[0];
    expect(harborOut.status).toBe('converted');
    expect(t.store.companies.get(harborOut.companyId!)!.opportunities).toEqual([]);
    // A converted candidate's host is a hard duplicate for every later run.
    const later = await runJob(t, api, 'rsch_later');
    expect(t.discovery.candidate(later.byName('Aurora Dental Studio').id).duplicates.matches[0]).toMatchObject({ level: 'hard' });
    // Nothing was sent or drafted.
    expect(t.store.mail.list()).toEqual([]);
    expect(t.store.followUps.list()).toEqual([]);
  });

  it('a candidate marked Uygun Değil is not converted until the decision is reversed', async () => {
    const t = setup();
    const api = await serve(t);
    const { byName } = await runJob(t, api, 'rsch_nf');
    const id = byName('Aurora Dental Studio').id;
    t.discovery.updateReview(id, { status: 'not_fit', rejectReason: 'Zincir klinik' });
    const refused = t.discovery.convert([{ resultId: id, services: ['website'] }])[0];
    expect(refused).toMatchObject({ status: 'not_convertible', ok: false });
    expect(refused.message).toMatch(/Uygun Değil/);
    expect(t.store.companies.list()).toEqual([]);
    t.discovery.updateReview(id, { status: 'fit' });
    expect(t.discovery.convert([{ resultId: id, services: ['website'] }])[0].status).toBe('converted');
  });

  it('Phase 14 demo safety: without the test opt-in, fixture candidates are never converted (server and legacy transfer)', async () => {
    const t = setup({ allowFictionalConversion: false });
    const api = await serve(t);
    const { byName } = await runJob(t, api, 'rsch_fx');
    const id = byName('Aurora Dental Studio').id;
    t.discovery.updateReview(id, { status: 'fit' });
    const refused = t.discovery.convert([{ resultId: id, services: ['crm'] }])[0];
    expect(refused).toMatchObject({ status: 'not_convertible', ok: false, message: "Demo sonuçları kurgusaldır ve CRM'e eklenemez." });
    const res = await api.send('POST', '/api/discovery/convert', { items: [{ resultId: id, services: ['crm'] }] });
    expect(((await res.json()) as { results: { ok: boolean }[] }).results[0].ok).toBe(false);
    expect(() => t.data.research.transfer('rsch_fx', [id])).toThrow(expect.objectContaining({ code: 'conflict', userMessage: "Demo sonuçları kurgusaldır ve CRM'e eklenemez." }));
    expect(t.store.companies.list()).toEqual([]);
  });

  it('bulk conversion isolates each candidate: one failure never rolls back the others', async () => {
    const t = setup();
    const api = await serve(t);
    const { byName } = await runJob(t, api, 'rsch_bulk');
    const aurora = byName('Aurora Dental Studio');
    const harbor = byName('Harbor Smile');
    const broken = byName('Broken Json Clinic');
    const out = t.discovery.convert([
      { resultId: aurora.id, services: ['website'] },
      { resultId: 'res_missing_1', services: ['website'] },
      { resultId: broken.id, services: ['website'] },
      { resultId: harbor.id, services: ['crm'] },
      { resultId: aurora.id, services: ['website'] }, // duplicate item ignored
    ]);
    expect(out.map((o) => [o.status, o.ok])).toEqual([
      ['converted', true],
      ['not_found', false],
      ['not_convertible', false],
      ['converted', true],
    ]);
    expect(t.store.companies.list().map((c) => c.name).sort()).toEqual(['Aurora Dental Studio', 'Harbor Smile']);
  });

  it('safe bulk review: Uygun Değil with a reason, services and sector; converted candidates are reported, not changed', async () => {
    const t = setup();
    const api = await serve(t);
    const { byName } = await runJob(t, api, 'rsch_br');
    const ids = [byName('Aurora Dental Studio').id, byName('Harbor Smile').id];
    t.discovery.convert([{ resultId: ids[0], services: ['website'] }]);
    const missingReason = t.discovery.bulk(ids, { type: 'status', status: 'not_fit' });
    expect(missingReason.map((r) => r.ok)).toEqual([false, false]);
    const res = await api.send('POST', '/api/discovery/bulk', { resultIds: ids, action: { type: 'status', status: 'not_fit', rejectReason: 'Bütçe yok' } });
    expect(((await res.json()) as { results: { ok: boolean }[] }).results.map((r) => r.ok)).toEqual([false, true]);
    expect(t.discovery.bulk([ids[1]], { type: 'services', services: ['seo'] })[0].ok).toBe(true);
    expect(t.discovery.bulk([ids[1]], { type: 'sector', sector: 'Ortodonti', sectorId: null })[0].ok).toBe(true);
    expect(t.store.discovery.getReview(ids[1])).toMatchObject({ status: 'not_fit', rejectReason: 'Bütçe yok', services: ['seo'], sector: 'Ortodonti' });
    expect((await api.send('POST', '/api/discovery/bulk', { resultIds: ids, action: { type: 'email' } })).status).toBe(400);
  });

  it('legacy transfer: only the primary service (or the explicit review selection); probable duplicates are skipped', async () => {
    const t = setup();
    const api = await serve(t);
    t.data.companies.create(companyInput('Harbor Smile', { country: 'United Arab Emirates' }));
    const { byName } = await runJob(t, api, 'rsch_lg');
    const aurora = byName('Aurora Dental Studio');
    const outcome = t.data.research.transfer('rsch_lg', [aurora.id, byName('Harbor Smile').id]);
    expect(outcome).toMatchObject({ added: 1, duplicates: 1 });
    expect(outcome.companies[0].opportunities.map((o) => o.service)).toEqual([aurora.serviceOpportunities![0].service]);
  });
});

describe('re-research', () => {
  it('keeps the latest 3 previous snapshots, reports what changed and never touches the review', async () => {
    const t = setup();
    const api = await serve(t);
    const { byName } = await runJob(t, api, 'rsch_rr');
    const harbor = byName('Harbor Smile');
    t.discovery.updateReview(harbor.id, { status: 'fit', notes: 'Not' });
    const review = t.store.discovery.getReview(harbor.id);
    for (let i = 0; i < 4; i++) await t.discovery.reresearch(harbor.id);
    const versions = t.discovery.versions(harbor.id);
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2]);
    expect(versions[0].snapshot).toHaveProperty('serviceOpportunities');
    expect(t.store.discovery.getReview(harbor.id)).toEqual(review);
    const res = await api.send('POST', `/api/discovery/candidates/${harbor.id}/reresearch`, {});
    expect(res.status).toBe(200);
    expect(Array.isArray(((await res.json()) as { changes: string[] }).changes)).toBe(true);
    // One at a time; converted candidates are refused.
    const first = t.discovery.reresearch(harbor.id);
    await expect(t.discovery.reresearch(harbor.id)).rejects.toMatchObject({ code: 'candidate_busy' });
    await first;
    t.discovery.convert([{ resultId: harbor.id, services: ['website'] }]);
    await expect(t.discovery.reresearch(harbor.id)).rejects.toMatchObject({ code: 'candidate_converted' });
  });
});
