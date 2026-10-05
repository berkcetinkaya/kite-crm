import { describe, expect, it } from 'vitest';
import type { AnalyzeEvent } from '../../src/domain/researchApi';
import type { ResearchCriteria } from '../../src/domain/research';
import { SERVICE_KEYS } from '../../src/domain/services';
import { runDiscovery, validateOfficialWebsite } from './discovery';
import { analyzeBatch } from './analysis';
import { createFixtureProvider, fixtureFetcher } from './fixtureProvider';
import { ProviderError, type ResearchProviderAdapter } from './provider';
import { parseAnalysis } from './schemas';

const criteria: ResearchCriteria = {
  service: 'crm',
  sector: 'Dental Clinic',
  country: 'United Arab Emirates',
  countryCode: 'AE',
  city: 'Dubai',
  companyCount: 10,
  criteria: 'Premium clinics with several treatments',
  exclusions: 'franchise branches',
};
const provider = createFixtureProvider();
const deps = { provider, fetchPage: fixtureFetcher, maxExtraPages: 3, now: () => new Date('2026-10-04T10:00:00Z') };

describe('discovery validation', () => {
  it('accepts verified candidates and rejects directories and duplicates', async () => {
    const r = await runDiscovery(provider, criteria, { targetCount: 10, maxSearches: 5, knownHosts: [], makeId: (i) => `c${i}` });
    expect(r.candidates.map((c) => c.name)).toEqual(['Aurora Dental Studio', 'Harbor Smile', 'Closed Clinic', 'Broken Json Clinic']);
    expect(r.rejected.map((x) => x.name)).toEqual(['Aurora Dental Studio (duplicate)', 'Directory Listing Clinic']);
    expect(r.candidates[1].website).toBe('https://harbor-smile.example/'); // normalised from bare domain
  });

  it('drops cited URLs that the search never returned', async () => {
    const r = await runDiscovery(provider, criteria, { targetCount: 10, maxSearches: 5, knownHosts: [] });
    const urls = r.candidates[0].evidence.map((e) => e.url);
    expect(urls).not.toContain('https://not-in-search.example/fake');
    // Discovery never fetches pages: a cited official-domain page is search evidence, not inspected.
    expect(r.candidates[0].evidence.map((e) => e.sourceType)).toEqual(['official_page_unfetched', 'directory']);
  });

  it('stores the canonical criteria country, not the model label (UAE and UK)', async () => {
    const labelled = (label: string): ResearchProviderAdapter => ({
      ...provider,
      discoverCompanies: async (input) => {
        const out = await provider.discoverCompanies(input);
        const raw = out.candidates as { candidates: { country: string }[] };
        return { ...out, candidates: { candidates: raw.candidates.map((c) => ({ ...c, country: label })) } };
      },
    });
    const uae = await runDiscovery(labelled('AE'), criteria, { targetCount: 10, maxSearches: 5, knownHosts: [] });
    expect(uae.candidates.map((c) => c.country)).toEqual(Array(4).fill('United Arab Emirates'));
    const ukCriteria = { ...criteria, country: 'United Kingdom', countryCode: 'GB', city: 'London' };
    const uk = await runDiscovery(labelled('UK'), ukCriteria, { targetCount: 10, maxSearches: 5, knownHosts: [] });
    expect(uk.candidates.every((c) => c.country === 'United Kingdom')).toBe(true);
    // Analysis output uses the same canonical value.
    const events: AnalyzeEvent[] = [];
    await analyzeBatch(deps, ukCriteria, [{ ...uk.candidates[0], country: 'UK' }], (e) => events.push(e));
    const done = events.find((e) => e.type === 'analyzed');
    expect(done?.type === 'analyzed' && done.result.country).toBe('United Kingdom');
  });

  it('never returns more than the requested count', async () => {
    const r = await runDiscovery(provider, criteria, { targetCount: 2, maxSearches: 5, knownHosts: [] });
    expect(r.candidates).toHaveLength(2);
  });

  it('handles "no results" as an empty list', async () => {
    const r = await runDiscovery(provider, { ...criteria, sector: 'empty sector' }, { targetCount: 5, maxSearches: 3, knownHosts: [] });
    expect(r.candidates).toEqual([]);
  });

  it('rejects an invalid provider response', async () => {
    await expect(
      runDiscovery(provider, { ...criteria, sector: 'invalid sector' }, { targetCount: 5, maxSearches: 3, knownHosts: [] }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('propagates provider outages as typed errors', async () => {
    await expect(
      runDiscovery(provider, { ...criteria, sector: 'unavailable' }, { targetCount: 5, maxSearches: 3, knownHosts: [] }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('validates official websites', () => {
    expect(validateOfficialWebsite('https://www.instagram.com/clinic')).toHaveProperty('error');
    expect(validateOfficialWebsite('http://192.168.0.1')).toHaveProperty('error');
    expect(validateOfficialWebsite(null)).toHaveProperty('error');
    expect(validateOfficialWebsite('dentglow.com.tr/en')).toEqual({ url: 'https://dentglow.com.tr/', host: 'dentglow.com.tr' });
  });
});

describe('analysis pipeline', () => {
  async function run() {
    const disc = await runDiscovery(provider, criteria, { targetCount: 10, maxSearches: 5, knownHosts: [], makeId: (i) => `c${i}` });
    const events: AnalyzeEvent[] = [];
    await analyzeBatch(deps, criteria, disc.candidates.slice(0, 3), (e) => events.push(e));
    await analyzeBatch(deps, criteria, disc.candidates.slice(3), (e) => events.push(e));
    return events;
  }

  it('produces partial results: successes, a fetch failure that still analyzes, and a failed analysis', async () => {
    const events = await run();
    const analyzed = events.filter((e) => e.type === 'analyzed');
    const failed = events.filter((e) => e.type === 'failed');
    expect(analyzed).toHaveLength(3);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ candidateId: 'c3', code: 'invalid_response' });
    expect(events.filter((e) => e.type === 'inspected')).toHaveLength(4);
  });

  it('scores all 7 services deterministically and keeps confidence separate', async () => {
    const a = (await run()).find((e) => e.type === 'analyzed' && e.result.companyName === 'Aurora Dental Studio');
    if (a?.type !== 'analyzed') throw new Error('missing');
    const r = a.result;
    expect(r.serviceOpportunities.map((o) => o.service).sort()).toEqual([...SERVICE_KEYS].sort());
    expect(r.serviceOpportunities[0]).toMatchObject({ service: 'crm', score: 90, recommendation: 'primary' });
    expect(r.overallScore).toBe(90);
    expect(r.verification).toMatchObject({ status: 'verified', confidence: 'high', officialWebsiteVerified: true });
    // Unknown signals are first-class and visible.
    const social = r.serviceOpportunities.find((o) => o.service === 'social_media')!;
    expect(social.signals.find((s) => s.key === 'posting_activity')).toMatchObject({ state: 'unknown', origin: 'not_inspected' });
    // Public contacts only, from official pages.
    expect(r.contactHints.map((h) => h.kind)).toEqual(['whatsapp', 'email', 'phone', 'contact_page', 'person']);
    // Same input → same output.
    const again = (await run()).find((e) => e.type === 'analyzed' && e.result.companyName === 'Aurora Dental Studio');
    expect(again?.type === 'analyzed' && again.result.serviceOpportunities).toEqual(r.serviceOpportunities);
  });

  it('website fetch failure lowers confidence instead of failing the company', async () => {
    const a = (await run()).find((e) => e.type === 'analyzed' && e.result.companyName === 'Closed Clinic');
    if (a?.type !== 'analyzed') throw new Error('missing');
    expect(a.result.analysis.websiteInspected).toBe(false);
    expect(a.result.analysis.warnings).toContain('Bu şirketin websitesi incelenemedi.');
    expect(a.result.serviceOpportunities.every((o) => o.confidence === 'low')).toBe(true);
    expect(a.result.verification.officialWebsiteVerified).toBe(false);
  });

  it('downgrades claims without evidence and ignores unknown evidence ids', () => {
    const parsed = parseAnalysis(
      {
        summary: 'x',
        signals: [{ service: 'crm', key: 'booking_flow', state: 'positive', reason: 'r', evidenceIds: ['e999'] }],
        websiteMatchEvidenceIds: ['e1', 'nope'],
      },
      new Set(['e1']),
    );
    expect(parsed.signals[0].evidenceIds).toEqual([]);
    expect(parsed.websiteMatchEvidenceIds).toEqual(['e1']);
  });

  it('a provider exception for one company does not fail the batch', async () => {
    const flaky: ResearchProviderAdapter = {
      ...provider,
      analyzeCompany: async (input) => {
        if (input.candidate.name === 'Harbor Smile') throw new ProviderError('rate_limit', 'slow down');
        return provider.analyzeCompany(input);
      },
    };
    const disc = await runDiscovery(provider, criteria, { targetCount: 2, maxSearches: 5, knownHosts: [] });
    const events: AnalyzeEvent[] = [];
    await analyzeBatch({ ...deps, provider: flaky }, criteria, disc.candidates, (e) => events.push(e));
    expect(events.filter((e) => e.type === 'analyzed')).toHaveLength(1);
    expect(events.find((e) => e.type === 'failed')).toMatchObject({ code: 'rate_limit' });
  });
});
