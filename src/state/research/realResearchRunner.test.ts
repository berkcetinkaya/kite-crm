import { describe, expect, it } from 'vitest';
import type { ResearchApi } from '../../api/researchApi';
import { ResearchApiError } from '../../api/researchApi';
import type { Company } from '../../domain/company';
import type { ResearchCriteria, ResearchRequest, ResearchResult } from '../../domain/research';
import type { AnalyzeEvent, AnalyzedCompany, DiscoveredCandidate } from '../../domain/researchApi';
import { analyzeServices, overallScore } from '../../domain/opportunityAnalysis';
import { EMPTY_TECHNICAL_FOR_TESTS } from './testFixtures';
import { runRealResearch } from './realResearchRunner';

const criteria: ResearchCriteria = {
  service: 'crm',
  sector: 'Dental Clinic',
  country: 'United Arab Emirates',
  countryCode: 'AE',
  city: 'Dubai',
  companyCount: 5,
  criteria: '',
  exclusions: '',
};

const candidate = (name: string, website: string): DiscoveredCandidate => ({
  id: name,
  name,
  website,
  city: 'Dubai',
  country: 'United Arab Emirates',
  sectorFit: 'dental',
  profileFit: 'unknown',
  confidence: 'medium',
  evidence: [],
});

const analyzed = (c: DiscoveredCandidate): AnalyzedCompany => {
  const ops = analyzeServices({ ...EMPTY_TECHNICAL_FOR_TESTS, inspected: true, hasViewport: false, ctaCount: 0, formCount: 0 }, {}, {});
  return {
    candidateId: c.id,
    companyName: c.name,
    website: c.website,
    sector: criteria.sector,
    city: c.city,
    country: c.country,
    companySize: null,
    verification: { status: 'verified', confidence: 'high', officialWebsiteVerified: true, locationVerified: true, sectorVerified: true, verified: [], unverified: [], evidenceIds: [] },
    evidence: [],
    analysis: { summary: 's', criteriaMatch: 'unknown', criteriaNotes: '', exclusionChecks: [], websiteInspected: true, warnings: [] },
    serviceOpportunities: ops,
    overallScore: overallScore(ops),
    contactHints: [],
    technical: EMPTY_TECHNICAL_FOR_TESTS,
    excluded: false,
  };
};

function harness(api: ResearchApi, companies: Partial<Company>[] = [], controller = new AbortController()) {
  let request: Partial<ResearchRequest> = {};
  const results = new Map<string, ResearchResult>();
  let n = 0;
  const run = runRealResearch(
    { api, requestId: 'req', criteria, companies: companies as Company[], signal: controller.signal, makeId: () => `r${++n}` },
    {
      patchRequest: (p) => (request = { ...request, ...p }),
      addResults: (rs) => rs.forEach((r) => results.set(r.id, r)),
      patchResult: (id, p) => results.set(id, { ...results.get(id)!, ...p }),
    },
  );
  return { run, get request() { return request; }, results };
}

/** Echoes candidates back; candidate names starting with "Fail" fail. Emits events like the server. */
const fakeApi = (candidates: DiscoveredCandidate[]): ResearchApi => ({
  status: async () => ({ ready: true, provider: 'fixture', reason: null, limits: { maxCompanies: 20, analyzeBatchSize: 3, maxTextField: 1000, maxShortField: 120 } }),
  discover: async () => ({ candidates, rejected: [], searchesUsed: 2 }),
  analyze: async (body, onEvent) => {
    for (const c of body.candidates) {
      onEvent({ type: 'inspected', candidateId: c.id, websiteOk: true });
      const e: AnalyzeEvent = c.name.startsWith('Fail')
        ? { type: 'failed', candidateId: c.id, code: 'invalid_response', message: 'Araştırma servisi beklenmeyen bir yanıt verdi.' }
        : { type: 'analyzed', candidateId: c.id, result: analyzed(c) };
      onEvent(e);
    }
    onEvent({ type: 'done' });
  },
});

describe('runRealResearch', () => {
  it('runs discovery and batched analysis with real progress counters', async () => {
    const h = harness(fakeApi([candidate('A', 'https://a.example/'), candidate('Fail B', 'https://b.example/'), candidate('C', 'https://c.example/'), candidate('D', 'https://d.example/')]));
    await h.run;
    expect(h.request.status).toBe('completed');
    expect(h.request.progress).toMatchObject({ candidates: 4, toAnalyze: 4, inspected: 4, analyzed: 3, failed: 1, stage: 'finalizing' });
    const statuses = [...h.results.values()].map((r) => r.researchStatus);
    expect(statuses.filter((s) => s === 'analyzed')).toHaveLength(3);
    expect(statuses.filter((s) => s === 'failed')).toHaveLength(1);
    const a = [...h.results.values()].find((r) => r.companyName === 'A')!;
    expect(a.source).toBe('web');
    expect(a.opportunityScore).toBeGreaterThan(0);
    expect(a.rankScore).toBeDefined();
  });

  it('marks companies already in prospects and skips their analysis', async () => {
    const h = harness(fakeApi([candidate('A', 'https://www.a.example/'), candidate('C', 'https://c.example/')]), [
      { id: 'x', name: 'Other name', website: 'a.example', country: 'United Arab Emirates' },
    ]);
    await h.run;
    const a = [...h.results.values()].find((r) => r.companyName === 'A')!;
    expect(a.researchStatus).toBe('existing');
    expect(a.alreadyInProspects).toBe(true);
    expect(h.request.progress?.toAnalyze).toBe(1);
  });

  it('reports "no verified companies" without failing', async () => {
    const h = harness(fakeApi([]));
    await h.run;
    expect(h.request.status).toBe('completed');
    expect(h.request.errorMessage).toBe('Arama kriterlerine uygun doğrulanmış şirket bulunamadı.');
  });

  it('maps a discovery failure to a Turkish error and failed status', async () => {
    const api = { ...fakeApi([]), discover: async () => { throw new ResearchApiError('not_configured'); } };
    const h = harness(api);
    await h.run;
    expect(h.request.status).toBe('failed');
    expect(h.request.errorMessage).toBe('Gerçek araştırmayı kullanmak için Anthropic API bağlantısı yapılandırılmalı.');
  });

  it('stops after a fatal batch error and keeps earlier results', async () => {
    let call = 0;
    const base = fakeApi(['A', 'B', 'C', 'D', 'E'].map((x) => candidate(x, `https://${x.toLowerCase()}.example/`)));
    const api: ResearchApi = {
      ...base,
      analyze: async (body, onEvent, signal) => {
        call += 1;
        if (call === 2) throw new ResearchApiError('server_unreachable');
        return base.analyze(body, onEvent, signal);
      },
    };
    const h = harness(api);
    await h.run;
    expect(h.request.progress).toMatchObject({ analyzed: 3, failed: 2 });
    expect(h.request.errorMessage).toBe('Araştırma sunucusuna ulaşılamıyor.');
  });

  it('cancellation keeps partial results', async () => {
    const controller = new AbortController();
    const base = fakeApi(['A', 'B', 'C', 'D'].map((x) => candidate(x, `https://${x.toLowerCase()}.example/`)));
    const api: ResearchApi = {
      ...base,
      analyze: async (body, onEvent, signal) => {
        await base.analyze(body, onEvent, signal);
        controller.abort(); // user presses "Araştırmayı Durdur" after the first batch
      },
    };
    const h = harness(api, [], controller);
    await h.run;
    expect(h.request.cancelled).toBe(true);
    expect([...h.results.values()].filter((r) => r.researchStatus === 'analyzed')).toHaveLength(3);
    expect([...h.results.values()].filter((r) => r.researchStatus === 'discovered')).toHaveLength(1);
  });
});
