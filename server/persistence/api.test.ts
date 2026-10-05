// Persistence API tests through real HTTP against an in-memory database (fixture providers only).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Company } from '../../src/domain/company';
import type { MailDraft } from '../../src/domain/mail/draft';
import type { ResearchRequest, ResearchResult } from '../../src/domain/research';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { openStore, type OpenedStore } from '../db/store';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createPersistenceServices } from './services';
import { sampleJob, sampleResult } from '../db/testFixtures';

let server: http.Server | undefined;
let store: OpenedStore | undefined;
afterEach(() => {
  server?.close();
  store?.close();
  server = undefined;
  store = undefined;
  vi.restoreAllMocks();
});

async function start(options: { data?: boolean } = {}) {
  store = openStore(':memory:');
  const config = loadConfig({ RESEARCH_PROVIDER: 'fixture' });
  const mailProvider = createFixtureMailProvider();
  const data = options.data === false ? null : createPersistenceServices(store, { mailProvider });
  server = http.createServer(createApp({ config, provider: null, mailProvider, data, fetchPage: fixtureFetcher }));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const call = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T & { error?: { code: string; message: string } } };
  };
  return { call, store: store! };
}

const newCompany = (over: Record<string, unknown> = {}) => ({
  name: 'Kaleiçi Taş Konak',
  website: 'kaleici-tas-konak.example',
  sector: 'Boutique Hotel',
  city: 'Antalya',
  country: 'Türkiye',
  source: 'manual',
  opportunities: [{ service: 'crm', score: 80, potential: 'high', reason: 'Rezervasyon yoğun' }],
  opportunityScore: 80,
  status: 'found',
  owner: 'Berk Çetinkaya',
  note: 'İlk not',
  ...over,
});

describe('prospects API', () => {
  it('creates, lists and edits companies; history and ids are issued by the server', async () => {
    const { call } = await start();
    const created = await call<{ company: Company }>('POST', '/api/prospects', { ...newCompany(), id: 'cmp_forged', history: [] });
    expect(created.status).toBe(201);
    const c = created.body.company;
    expect(c.id).not.toBe('cmp_forged');
    expect(c).toMatchObject({ sector: 'Butik Otel', sectorId: 'boutique_hotel', status: 'found' });
    expect(c.notes).toHaveLength(1);
    expect(c.history.map((h) => h.type)).toEqual(['note_added', 'created']);

    const edited = await call<{ company: Company }>('PATCH', `/api/prospects/${c.id}`, { patch: { city: 'Kaş', sector: 'Dental Clinic', sectorId: 'hotel' } });
    expect(edited.body.company).toMatchObject({ city: 'Kaş', sector: 'Diş Kliniği', sectorId: 'dental_clinic' });
    expect(edited.body.company.history[0].description).toContain('Şehir');

    const status = await call<{ company: Company }>('POST', `/api/prospects/${c.id}/status`, { status: 'researched' });
    expect(status.body.company.status).toBe('researched');
    const note = await call<{ company: Company }>('POST', `/api/prospects/${c.id}/notes`, { content: 'İkinci not' });
    expect(note.body.company.notes.map((n) => n.content)).toEqual(['İkinci not', 'İlk not']);
    const contact = await call<{ company: Company }>('POST', `/api/prospects/${c.id}/contacts`, {
      contact: { fullName: 'Ayşe Yılmaz', role: 'Müdür', email: 'a@x.example', phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' },
    });
    const ct = contact.body.company.contacts[0];
    const updated = await call<{ company: Company }>('PUT', `/api/prospects/${c.id}/contacts/${ct.id}`, { contact: { ...ct, role: 'Genel Müdür' } });
    expect(updated.body.company.contacts[0]).toMatchObject({ id: ct.id, role: 'Genel Müdür' });
    const opps = await call<{ company: Company }>('PUT', `/api/prospects/${c.id}/opportunities`, { opportunities: [{ service: 'seo', score: 50, potential: null, reason: '' }] });
    expect(opps.body.company.opportunities.map((o) => o.service)).toEqual(['seo']);

    const list = await call<{ companies: Company[] }>('GET', '/api/prospects');
    expect(list.body.companies).toEqual([opps.body.company]);
  });

  it('validates payloads and answers in Turkish', async () => {
    const { call } = await start();
    const bad = await call('POST', '/api/prospects', newCompany({ status: 'sent' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toEqual({ code: 'invalid_request', message: 'Gönderilen bilgiler geçersiz.' });
    expect((await call('POST', '/api/prospects', newCompany({ name: '' }))).status).toBe(400);
    expect((await call('POST', '/api/prospects', newCompany({ opportunityScore: 101 }))).status).toBe(400);
    expect((await call('POST', '/api/prospects', newCompany({ owner: 'Someone Else' }))).body.error?.message).toBe('Sorumlu kişi tanınmıyor.');
    const missing = await call('POST', '/api/prospects/cmp_nope_1/status', { status: 'found' });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.message).toBe('Şirket bulunamadı.');
    expect((await call('GET', '/api/prospects/unknown/thing')).status).toBe(404);
  });

  it('reports a missing database as unavailable, in Turkish', async () => {
    const { call } = await start({ data: false });
    const res = await call('GET', '/api/prospects');
    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe('storage_unavailable');
  });
});

describe('research API', () => {
  it('saves and lists jobs and results; transfer links are never taken from the client', async () => {
    const { call } = await start();
    const job = sampleJob({ sector: 'Dental Clinic', sectorId: null });
    expect((await call<{ job: ResearchRequest }>('PUT', `/api/research/jobs/${job.id}`, { job })).body.job).toMatchObject({ sector: 'Diş Kliniği', sectorId: 'dental_clinic' });
    const forged = { ...sampleResult(), transferredCompanyId: 'cmp_forged' };
    expect((await call('PUT', `/api/research/jobs/${job.id}/results`, { results: [forged] })).status).toBe(200);
    const list = await call<{ jobs: ResearchRequest[]; resultsByJob: Record<string, ResearchResult[]> }>('GET', '/api/research/jobs');
    expect(list.body.jobs.map((j) => j.id)).toEqual([job.id]);
    const stored = list.body.resultsByJob[job.id][0];
    expect(stored.transferredCompanyId).toBeNull();
    expect(stored.evidence?.map((e) => e.sourceType)).toEqual(['official_website', 'directory']);
  });

  it('rejects malformed research payloads', async () => {
    const { call } = await start();
    const job = sampleJob();
    expect((await call('PUT', `/api/research/jobs/${job.id}`, { job: { ...job, status: 'exploded' } })).status).toBe(400);
    expect((await call('PUT', `/api/research/jobs/other_1`, { job })).status).toBe(400);
    await call('PUT', `/api/research/jobs/${job.id}`, { job });
    const badEvidence = sampleResult({ evidence: [{ id: 'w1', url: 'javascript:alert(1)', title: 't', sourceType: 'official_website', claim: '', retrievedAt: '2026-10-05T09:01:00.000Z' }] });
    expect((await call('PUT', `/api/research/jobs/${job.id}/results`, { results: [badEvidence] })).status).toBe(400);
    const badType = sampleResult({ evidence: [{ id: 'w1', url: 'https://a.example/', title: 't', sourceType: 'inspected_by_me' as never, claim: '', retrievedAt: '2026-10-05T09:01:00.000Z' }] });
    expect((await call('PUT', `/api/research/jobs/${job.id}/results`, { results: [badType] })).status).toBe(400);
    expect((await call('PUT', `/api/research/jobs/rsch_missing/results`, { results: [sampleResult()] })).status).toBe(404);
  });

  it('transfers selected results with provenance and detects stored duplicates', async () => {
    const { call } = await start();
    const job = sampleJob();
    await call('PUT', `/api/research/jobs/${job.id}`, { job });
    await call('PUT', `/api/research/jobs/${job.id}/results`, {
      results: [sampleResult({ selected: true }), sampleResult({ id: 'res_2', companyName: 'Harbor Smile', website: 'https://harbor-smile.example/', selected: true })],
    });
    // Harbor Smile already exists (same website, different spelling).
    await call('POST', '/api/prospects', newCompany({ name: 'Harbor Smile Dental', website: 'www.harbor-smile.example', country: 'AE' }));
    const t = await call<{ added: number; duplicates: number; companies: Company[]; results: ResearchResult[] }>('POST', `/api/research/jobs/${job.id}/transfer`, {});
    expect(t.body).toMatchObject({ added: 1, duplicates: 1 });
    const company = t.body.companies[0];
    expect(company).toMatchObject({ name: 'Aurora Dental Studio', country: 'United Arab Emirates', source: 'research' });
    expect(company.researchRef).toMatchObject({ requestId: job.id, mode: 'real' });
    expect(company.researchRef?.sources?.[0]).toMatchObject({ sourceType: 'official_website' });
    expect(t.body.results.find((r) => r.id === 'res_1')).toMatchObject({ transferredCompanyId: company.id, selected: false, alreadyInProspects: true });
    expect(t.body.results.find((r) => r.id === 'res_2')).toMatchObject({ transferredCompanyId: null, alreadyInProspects: true });
    // A second transfer adds nothing.
    expect((await call<{ added: number }>('POST', `/api/research/jobs/${job.id}/transfer`, { resultIds: ['res_1'] })).body.added).toBe(0);
  });

  it('a transfer that fails half way saves nothing', async () => {
    const { call, store } = await start();
    const job = sampleJob();
    await call('PUT', `/api/research/jobs/${job.id}`, { job });
    await call('PUT', `/api/research/jobs/${job.id}/results`, {
      results: [sampleResult({ selected: true }), sampleResult({ id: 'res_2', companyName: 'Second', website: 'https://second.example/', selected: true })],
    });
    const insert = store.companies.insert.bind(store.companies);
    let n = 0;
    vi.spyOn(store.companies, 'insert').mockImplementation((c) => {
      n += 1;
      if (n === 2) throw new Error('disk full');
      insert(c);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('POST', `/api/research/jobs/${job.id}/transfer`, {});
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'storage_error', message: 'Değişiklik kaydedilemedi. Lütfen tekrar dene.' });
    expect(store.companies.list()).toEqual([]);
    expect(store.research.listResults(job.id).every((r) => r.transferredCompanyId === null && r.selected)).toBe(true);
  });
});

describe('mail drafts API', () => {
  it('generates, saves, approves and regenerates with preserved versions (fixture provider)', async () => {
    const { call } = await start();
    const company = (await call<{ company: Company }>('POST', '/api/prospects', newCompany())).body.company;
    const gen = await call<{ draft: MailDraft }>('POST', '/api/mail/drafts/generate', { companyId: company.id, service: 'crm', language: 'tr', contactId: null, preserve: null });
    expect(gen.status).toBe(200);
    const d = gen.body.draft;
    expect(d).toMatchObject({ companyId: company.id, status: 'review', language: 'tr', service: 'crm', editedSinceGeneration: false });
    expect(d.subjectOptions).toHaveLength(3);
    expect(d.generationNotes.provider).toBe('fixture');

    const saved = await call<{ draft: MailDraft }>('POST', `/api/mail/drafts/${d.id}/save`, { edits: { selectedSubject: d.subjectOptions[1], body: `${d.body}\n\nPS` } });
    expect(saved.body.draft).toMatchObject({ status: 'draft', selectedSubject: d.subjectOptions[1], editedSinceGeneration: true });
    const approved = await call<{ draft: MailDraft }>('POST', `/api/mail/drafts/${d.id}/approve`, { edits: { selectedSubject: d.subjectOptions[1], body: `${d.body}\n\nPS` } });
    expect(approved.body.draft.status).toBe('approved');
    expect(approved.body.draft.approvedAt).toBeTruthy();

    const regen = await call<{ draft: MailDraft }>('POST', '/api/mail/drafts/generate', {
      companyId: company.id, service: 'crm', language: 'en', contactId: null, preserve: { selectedSubject: d.subjectOptions[1], body: `${d.body}\n\nPS` },
    });
    expect(regen.body.draft).toMatchObject({ id: d.id, status: 'review', language: 'en', approvedAt: null });
    expect(regen.body.draft.previousVersions[0]).toMatchObject({ subject: d.subjectOptions[1], reason: 'before_regeneration' });
    expect((await call<{ drafts: MailDraft[] }>('GET', '/api/mail/drafts')).body.drafts).toEqual([regen.body.draft]);

    // The company's sales status is never changed by drafting or approval.
    expect((await call<{ companies: Company[] }>('GET', '/api/prospects')).body.companies[0].status).toBe('found');
  });

  it('uses the stored research of a transferred company (evidence comes from the server)', async () => {
    const { call } = await start();
    const job = sampleJob();
    await call('PUT', `/api/research/jobs/${job.id}`, { job });
    await call('PUT', `/api/research/jobs/${job.id}/results`, { results: [sampleResult({ selected: true, serviceOpportunities: [{ service: 'crm', score: 90, confidence: 'high', recommendation: 'primary', reason: 'r', evidenceIds: ['w1'], signals: [{ key: 'multiple_locations', label: 'l', state: 'positive', reason: 'r', evidenceIds: ['w1'], origin: 'analysis', weight: 2 }] }] })] });
    const t = await call<{ companies: Company[] }>('POST', `/api/research/jobs/${job.id}/transfer`, {});
    const gen = await call<{ draft: MailDraft }>('POST', '/api/mail/drafts/generate', { companyId: t.body.companies[0].id, service: 'crm', language: 'en', contactId: null, preserve: null });
    expect(gen.body.draft.researchJobId).toBe(job.id);
    expect(gen.body.draft.generationNotes.personalization).toBe('specific');
    expect(gen.body.draft.evidenceRefs).toEqual([expect.objectContaining({ id: 'w1', inspected: true })]);
  });

  it('rejects unknown companies, invalid language and unknown drafts', async () => {
    const { call } = await start();
    expect((await call('POST', '/api/mail/drafts/generate', { companyId: 'cmp_missing_1', service: 'crm', language: 'tr', contactId: null, preserve: null })).status).toBe(404);
    expect((await call('POST', '/api/mail/drafts/generate', { companyId: 'cmp_missing_1', service: 'crm', language: 'de', contactId: null, preserve: null })).status).toBe(400);
    expect((await call('POST', '/api/mail/drafts/mail_missing_1/save', { edits: { selectedSubject: 'a', body: 'b' } })).status).toBe(404);
  });
});
