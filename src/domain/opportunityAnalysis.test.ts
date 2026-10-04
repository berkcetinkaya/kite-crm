import { describe, expect, it } from 'vitest';
import {
  analyzeServices,
  confidenceFromCoverage,
  overallScore,
  PRIOR_WEIGHT,
  rankScore,
  scoreSignals,
  SERVICE_SIGNALS,
  verificationStatus,
} from './opportunityAnalysis';
import { findProspectMatch, type WebsiteTechnicalSummary } from './research';
import { SERVICE_KEYS } from './services';
import { websiteHost } from '../lib/url';

const tech = (over: Partial<WebsiteTechnicalSummary> = {}): WebsiteTechnicalSummary => ({
  inspected: true,
  finalUrl: 'https://a.example/',
  https: true,
  httpStatus: 200,
  redirected: false,
  responseTimeMs: 800,
  hasViewport: true,
  hasTitle: true,
  hasMetaDescription: true,
  h1Count: 1,
  formCount: 1,
  ctaCount: 4,
  hasBookingSignal: true,
  hasEcommerceSignal: false,
  hasWhatsApp: true,
  hasEmail: true,
  hasPhone: true,
  hasContactPage: true,
  socialLinks: ['https://instagram.com/a'],
  language: 'en',
  hasStructuredData: true,
  hasCanonical: true,
  pagesInspected: [],
  ...over,
});

describe('scoring', () => {
  it('uses the documented formula', () => {
    expect(scoreSignals([{ state: 'positive', weight: 3 }])).toEqual({
      score: Math.round((100 * (3 + PRIOR_WEIGHT * 0.5)) / (3 + PRIOR_WEIGHT)),
      coverage: 1,
    });
    expect(scoreSignals([]).score).toBe(50);
  });

  it('unknown signals lower coverage, not the score', () => {
    const known = scoreSignals([{ state: 'positive', weight: 3 }]);
    const withUnknown = scoreSignals([{ state: 'positive', weight: 3 }, { state: 'unknown', weight: 3 }]);
    expect(withUnknown.score).toBe(known.score);
    expect(withUnknown.coverage).toBe(0.5);
  });

  it('every service has its own criteria', () => {
    for (const s of SERVICE_KEYS) expect(SERVICE_SIGNALS[s].length).toBeGreaterThanOrEqual(5);
  });

  it('scores all 7 services, ranks them and recommends only meaningful ones', () => {
    // A clearly weak site: every measured website check supports a Website Yenileme opportunity.
    const weakSite = tech({
      https: false,
      hasViewport: false,
      hasMetaDescription: false,
      h1Count: 0,
      ctaCount: 0,
      formCount: 0,
      hasBookingSignal: false,
      hasWhatsApp: false,
      hasEmail: false,
      hasPhone: false,
      hasContactPage: false,
      responseTimeMs: 4200,
    });
    const all = analyzeServices(weakSite, {}, {});
    expect(all).toHaveLength(7);
    expect(all[0].service).toBe('website');
    expect(all[0].recommendation).toBe('primary');
    expect(all.filter((o) => o.recommendation === 'secondary').length).toBeLessThanOrEqual(2);
    expect(all.filter((o) => o.score < 60).every((o) => o.recommendation === 'none')).toBe(true);
  });

  it('confidence follows coverage and is capped when the site was not inspected', () => {
    expect(confidenceFromCoverage(0.8, true)).toBe('high');
    expect(confidenceFromCoverage(0.5, true)).toBe('medium');
    expect(confidenceFromCoverage(0.2, true)).toBe('low');
    expect(confidenceFromCoverage(0.9, false)).toBe('low');
    const notInspected = analyzeServices({ ...tech(), inspected: false }, {}, {});
    expect(notInspected.every((o) => o.confidence === 'low')).toBe(true);
  });

  it('overall score and ranking are transparent', () => {
    expect(overallScore([{ score: 88 }, { score: 80 }, { score: 40 }])).toBe(86);
    expect(rankScore({ overall: 86, verification: 'verified', primaryConfidence: 'high', criteriaMatch: 'strong' })).toBe(106);
    expect(rankScore({ overall: 86, verification: 'unverified', primaryConfidence: 'low', criteriaMatch: 'weak' })).toBe(51);
  });

  it('verification status rule', () => {
    expect(verificationStatus({ officialWebsiteVerified: true, locationVerified: true, sectorVerified: true }).status).toBe('verified');
    expect(verificationStatus({ officialWebsiteVerified: true, locationVerified: false, sectorVerified: false }).status).toBe('partial');
    expect(verificationStatus({ officialWebsiteVerified: false, locationVerified: true, sectorVerified: true }).status).toBe('partial');
    expect(verificationStatus({ officialWebsiteVerified: false, locationVerified: true, sectorVerified: false })).toEqual({ status: 'unverified', confidence: 'low' });
  });
});

describe('duplicate detection', () => {
  const companies = [
    { id: '1', name: 'DentGlow Clinic', website: 'dentglow.com.tr', country: 'Türkiye' },
    { id: '2', name: 'Smile Center', website: null, country: 'United Arab Emirates' },
  ];

  it('normalises websites', () => {
    for (const w of ['https://www.dentglow.com.tr/', 'http://dentglow.com.tr', 'DENTGLOW.com.tr/en/', 'www.dentglow.com.tr']) {
      expect(findProspectMatch({ name: 'x', website: w }, companies)?.id).toBe('1');
    }
    expect(websiteHost('https://www2.Example.com:443/path?q=1')).toBe('example.com');
  });

  it('falls back to name + country and does not merge across countries', () => {
    expect(findProspectMatch({ name: 'smile center', website: null, country: 'United Arab Emirates' }, companies)?.id).toBe('2');
    expect(findProspectMatch({ name: 'Smile Center', website: null, country: 'United Kingdom' }, companies)).toBeNull();
    expect(findProspectMatch({ name: 'DentGlow Clinic', website: 'dentglow-dubai.ae', country: 'United Arab Emirates' }, companies)).toBeNull();
  });
});
