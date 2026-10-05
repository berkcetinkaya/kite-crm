import { describe, expect, it } from 'vitest';
import type { ResearchRequest, ResearchResult } from '../../domain/research';
import { companyInputForWebResult } from './ResearchProvider';

const request = (country: string, countryCode: string | null): ResearchRequest => ({
  id: 'req1',
  name: 'Dubai Dental Clinic • CRM',
  service: 'crm',
  sector: 'Dental Clinic',
  country,
  countryCode,
  city: 'Dubai',
  companyCount: 3,
  criteria: '',
  exclusions: '',
  status: 'completed',
  mode: 'real',
  isDemo: false,
  provider: 'anthropic',
  createdAt: '',
  updatedAt: '',
  startedAt: null,
  completedAt: null,
  resultCount: 1,
  progress: null,
  errorMessage: null,
  cancelled: false,
});

const result = (country: string): ResearchResult => ({
  id: 'r1',
  researchRequestId: 'req1',
  companyName: "Dr. Michael's Dental Clinic",
  website: 'https://drmichael.example/',
  sector: 'Dental Clinic',
  city: 'Dubai',
  country,
  source: 'web',
  service: 'crm',
  opportunityScore: 70,
  reason: '',
  companySize: null,
  confidence: 'low',
  selected: true,
  alreadyInProspects: false,
  transferredCompanyId: null,
  researchStatus: 'analyzed',
  createdAt: '2026-10-05T10:00:00Z',
  serviceOpportunities: [],
  evidence: [
    { id: 'd1', url: 'https://drmichael.example/about-us', title: 'About', sourceType: 'official_page_unfetched', claim: '', retrievedAt: '' },
    { id: 'w1', url: 'https://drmichael.example/', title: 'Home', sourceType: 'official_website', claim: '', retrievedAt: '' },
  ],
});

describe('transfer to Potansiyel Müşteriler', () => {
  it('saves the canonical country even if the result carries the model label "AE"', () => {
    expect(companyInputForWebResult(result('AE'), request('United Arab Emirates', 'AE')).country).toBe('United Arab Emirates');
  });

  it('saves the canonical country for another market', () => {
    expect(companyInputForWebResult(result('UK'), request('United Kingdom', 'GB')).country).toBe('United Kingdom');
  });

  it('keeps research provenance with inspected pages listed first', () => {
    const input = companyInputForWebResult(result('AE'), request('United Arab Emirates', 'AE'));
    expect(input.researchRef?.sourceUrls).toEqual(['https://drmichael.example/', 'https://drmichael.example/about-us']);
    // Provenance travels with the sources: the unfetched page stays marked as not inspected.
    expect(input.researchRef?.sources?.map((x) => x.sourceType)).toEqual(['official_website', 'official_page_unfetched']);
  });
});
