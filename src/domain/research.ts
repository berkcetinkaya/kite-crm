// Research request (job) and result model. Phase 3 fills these with demo data; Phase 4 will run
// real research into the same shapes.
import type { Company, CompanySize, ContactConfidence } from './company';
import { SERVICES, type ServiceKey } from './services';
import { foldForSearch } from '../lib/text';
import { normalizeWebsite } from '../lib/url';

export const RESEARCH_STATUS_ORDER = ['draft', 'ready', 'running', 'completed', 'failed'] as const;
export type ResearchStatus = (typeof RESEARCH_STATUS_ORDER)[number];

export const RESEARCH_STATUS: Record<ResearchStatus, string> = {
  draft: 'Taslak',
  ready: 'Hazır',
  running: 'Araştırılıyor',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
};

export interface ResearchCriteria {
  service: ServiceKey;
  sector: string;
  /** Country name as stored on companies, e.g. "United Arab Emirates". */
  country: string;
  /** ISO code when the country came from the structured list; null for free-text countries. */
  countryCode: string | null;
  /** Null means country-wide research. */
  city: string | null;
  companyCount: number;
  /** "Aradığım Şirket Profili" (free text). */
  criteria: string;
  /** "Hariç Tutulacak Şirketler / Kriterler" (free text). */
  exclusions: string;
}

export interface ResearchRequest extends ResearchCriteria {
  id: string;
  name: string;
  status: ResearchStatus;
  /** True while results are demo data rather than real research output. */
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  resultCount: number;
}

/** Where a result came from. Phase 4 adds real sources (web search, maps, directories…). */
export type ResearchResultSource = 'demo';

export const RESEARCH_RESULT_SOURCES: Record<ResearchResultSource, string> = {
  demo: 'Demo veri',
};

export interface ResearchResult {
  id: string;
  researchRequestId: string;
  companyName: string;
  website: string | null;
  sector: string;
  city: string | null;
  country: string;
  source: ResearchResultSource;
  service: ServiceKey;
  /** 0–100. Demo value in Phase 3; never calculated here. */
  opportunityScore: number;
  reason: string;
  companySize: CompanySize | null;
  confidence: ContactConfidence;
  selected: boolean;
  /** Matched an existing prospect when the job finished. The UI re-checks live (see findProspectMatch). */
  alreadyInProspects: boolean;
  /** Set when this result was transferred to Potansiyel Müşteriler. */
  transferredCompanyId: string | null;
}

/** "Dubai Dental Klinik • CRM", "United States Luxury Real Estate • Google Ads". */
export function researchName(c: Pick<ResearchCriteria, 'service' | 'sector' | 'country' | 'city'>): string {
  const place = c.city?.trim() || c.country.trim();
  return `${place} ${c.sector.trim()} • ${SERVICES[c.service].label}`;
}

/**
 * Finds an existing company that is the same business as a candidate. Normalized website first
 * (most reliable across languages), company name as fallback.
 */
export function findProspectMatch(
  candidate: { name: string; website: string | null },
  companies: readonly Pick<Company, 'id' | 'name' | 'website'>[],
): Pick<Company, 'id' | 'name' | 'website'> | null {
  const site = candidate.website ? normalizeWebsite(candidate.website) : null;
  if (site) {
    const bySite = companies.find((c) => c.website && normalizeWebsite(c.website) === site);
    if (bySite) return bySite;
  }
  const name = foldForSearch(candidate.name.trim());
  return companies.find((c) => foldForSearch(c.name.trim()) === name) ?? null;
}
