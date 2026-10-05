// Reproduces the Phase 4.1 "Dr. Michael's" finding offline: the official homepage answers 403, but
// discovery cited another page on the same domain that KITE never fetched. That citation must stay
// search evidence and must not satisfy the rules reserved for pages KITE inspected.
import { describe, expect, it } from 'vitest';
import type { AnalyzeEvent, AnalyzedCompany } from '../../src/domain/researchApi';
import { isInspectedEvidence, type ResearchCriteria } from '../../src/domain/research';
import { FetchError, type PageFetcher } from '../web/safeFetch';
import { analyzeBatch } from './analysis';
import { runDiscovery } from './discovery';
import type { AnalysisInput, ResearchProviderAdapter } from './provider';
import { validateCandidates } from './validateRequest';

const criteria: ResearchCriteria = {
  service: 'crm',
  sector: 'Dental Clinic',
  country: 'United Arab Emirates',
  countryCode: 'AE',
  city: 'Dubai',
  companyCount: 3,
  criteria: '',
  exclusions: '',
};

const SITE = 'https://drmichael.example';
const ABOUT = `${SITE}/about-us`;

/** Fetcher: the homepage answers 403; records every URL KITE asks for. */
function forbiddenFetcher(requested: string[]): PageFetcher {
  return async (url) => {
    requested.push(url);
    throw new FetchError('http_error', 'fixture: 403', 403);
  };
}

/** Provider that behaves like the live model did: it relies on the unfetched same-domain page. */
const provider: ResearchProviderAdapter = {
  id: 'fixture',
  async discoverCompanies() {
    return {
      candidates: {
        candidates: [
          {
            name: "Dr. Michael's Dental Clinic",
            officialWebsite: SITE,
            city: 'Dubai',
            country: 'AE', // the model's label; must not become the CRM value
            sectorFit: 'Dental clinic',
            profileFit: 'partial',
            confidence: 'medium',
            sources: [
              { url: ABOUT, title: "About Dr. Michael's", sourceType: 'official_page', claim: 'Dental clinic in Jumeirah, Dubai.' },
              { url: `${SITE}/team`, title: 'Team', sourceType: 'official_page', claim: 'Never returned by search.' },
            ],
          },
        ],
      },
      searchResults: [{ url: ABOUT, title: "About Dr. Michael's Dental Clinic" }],
      searchesUsed: 2,
    };
  },
  async analyzeCompany(input: AnalysisInput) {
    const cited = input.evidence.find((e) => e.url === ABOUT)!.id;
    return {
      websiteMatchesCompany: true,
      websiteMatchEvidenceIds: [cited],
      locationVerified: true,
      locationEvidenceIds: [cited],
      observedCity: 'Dubai',
      sectorVerified: true,
      sectorEvidenceIds: [cited],
      summary: 'Dubai merkezli bir diş kliniği.',
      criteriaMatch: 'partial',
      criteriaNotes: '',
      exclusionChecks: [],
      companySize: null,
      companySizeEvidenceIds: [],
      signals: input.signals.map((s) => ({ service: s.service, key: s.key, state: 'unknown', reason: '', evidenceIds: [] })),
      serviceReasons: [],
      people: [{ name: 'Dr. Michael', role: 'Founder', evidenceIds: [cited] }],
    };
  },
};

async function analyze(candidates: Parameters<typeof analyzeBatch>[2], requested: string[]): Promise<AnalyzedCompany> {
  const events: AnalyzeEvent[] = [];
  await analyzeBatch(
    { provider, fetchPage: forbiddenFetcher(requested), maxExtraPages: 3, now: () => new Date('2026-10-05T10:00:00Z') },
    criteria,
    candidates,
    (e) => events.push(e),
  );
  expect(events.find((e) => e.type === 'inspected')).toMatchObject({ websiteOk: false });
  const analyzed = events.find((e) => e.type === 'analyzed');
  if (analyzed?.type !== 'analyzed') throw new Error('analysis missing');
  return analyzed.result;
}

describe('evidence provenance: homepage 403 + unfetched same-domain citation', () => {
  it('discovery keeps the cited page only as unfetched search evidence', async () => {
    const r = await runDiscovery(provider, criteria, { targetCount: 3, maxSearches: 3, knownHosts: [], makeId: () => 'c1' });
    expect(r.candidates[0].evidence).toEqual([
      expect.objectContaining({ url: ABOUT, sourceType: 'official_page_unfetched' }),
    ]);
    // A same-domain URL that never appeared in the search results is dropped entirely.
    expect(r.candidates[0].evidence.map((e) => e.url)).not.toContain(`${SITE}/team`);
    expect(r.candidates[0].evidence.some(isInspectedEvidence)).toBe(false);
  });

  it('the unfetched citation is never fetched and never counts as inspected official evidence', async () => {
    const disc = await runDiscovery(provider, criteria, { targetCount: 3, maxSearches: 3, knownHosts: [], makeId: () => 'c1' });
    const requested: string[] = [];
    const result = await analyze(disc.candidates, requested);

    expect(requested.some((u) => u.includes('/about-us'))).toBe(false);
    expect(result.evidence.find((e) => e.url === ABOUT)?.sourceType).toBe('official_page_unfetched');
    expect(result.evidence.some(isInspectedEvidence)).toBe(false);
    expect(result.analysis.websiteInspected).toBe(false);

    // The model claimed a website match from the unfetched page: rejected.
    expect(result.verification.officialWebsiteVerified).toBe(false);
    // Location/sector rest on search evidence only, and say so.
    expect(result.verification).toMatchObject({
      locationVerified: true,
      sectorVerified: true,
      locationBasis: 'search_only',
      sectorBasis: 'search_only',
      status: 'partial',
      confidence: 'low',
    });
    expect(result.verification.verified.join(' ')).toContain('yalnızca arama sonuçlarıyla');
    expect(result.verification.unverified).toContain('Resmi website incelenemedi.');
    expect(result.analysis.warnings).toContain('Bu şirketin websitesi incelenemedi.');
    expect(result.analysis.warnings.join(' ')).toContain('yalnızca arama sonuçlarına dayanıyor');
    // People named only on an unfetched page are not turned into contacts.
    expect(result.contactHints.filter((h) => h.kind === 'person')).toEqual([]);
    // Canonical CRM country, not the model's "AE".
    expect(result.country).toBe('United Arab Emirates');
  });

  it('evidence sent back by the browser as "official_page" is still treated as unfetched', async () => {
    const disc = await runDiscovery(provider, criteria, { targetCount: 3, maxSearches: 3, knownHosts: [], makeId: () => 'c1' });
    const tampered = disc.candidates.map((c) => ({
      ...c,
      evidence: [
        ...c.evidence.map((e) => ({ ...e, sourceType: 'official_page' as const })),
        { id: 'w1', url: `${SITE}/fake`, title: 'Fake', sourceType: 'official_website' as const, claim: 'x', retrievedAt: '' },
      ],
    }));
    const [validated] = validateCandidates(JSON.parse(JSON.stringify(tampered)), 3);
    const result = await analyze([validated], []);
    expect(result.evidence.some(isInspectedEvidence)).toBe(false);
    expect(result.verification).toMatchObject({ officialWebsiteVerified: false, status: 'partial', confidence: 'low', locationBasis: 'search_only' });
    expect(result.contactHints.filter((h) => h.kind === 'person')).toEqual([]);
  });
});
