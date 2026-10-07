// Research request (job) and result model. Demo jobs (Phase 3) and real jobs (Phase 4) share these
// shapes; real results add verification, evidence and per-service analysis.
import type { Company, CompanySize, ContactConfidence } from './company';
import { SERVICES, type ServiceKey } from './services';
import { foldForSearch } from '../lib/text';
import { websiteHost } from '../lib/url';
import { countryMatchKey } from './locations';

export const RESEARCH_STATUS_ORDER = ['draft', 'ready', 'running', 'completed', 'failed'] as const;
export type ResearchStatus = (typeof RESEARCH_STATUS_ORDER)[number];

export const RESEARCH_STATUS: Record<ResearchStatus, string> = {
  draft: 'Taslak',
  ready: 'Hazır',
  running: 'Araştırılıyor',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
};

/** Demo = Phase 3 fictional data. Real = server-side web research. */
export type ResearchMode = 'demo' | 'real';

/** Which backend produced a real job. "fixture" is the offline test provider and is labelled as such. */
export type ResearchProviderId = 'anthropic' | 'fixture';

export interface ResearchCriteria {
  service: ServiceKey;
  /** Turkish label for catalogue sectors, the typed text for custom sectors. */
  sector: string;
  /** Catalogue sector id when known (see sectorTaxonomy). Absent on jobs created before Phase 5. */
  sectorId?: string | null;
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

/** Real-research stages, in order. Progress only moves when the work for a stage actually completes. */
export const REAL_RESEARCH_STAGES = ['discovering', 'inspecting', 'analyzing', 'finalizing'] as const;
export type RealResearchStage = (typeof REAL_RESEARCH_STAGES)[number];

export const REAL_RESEARCH_STAGE_LABELS: Record<RealResearchStage, string> = {
  discovering: 'Şirketler aranıyor',
  inspecting: 'Websiteleri doğrulanıyor ve inceleniyor',
  analyzing: 'Fırsatlar analiz ediliyor',
  finalizing: 'Sonuçlar hazırlanıyor',
};

export interface RealResearchProgress {
  stage: RealResearchStage;
  /** Candidates accepted after discovery validation. */
  candidates: number;
  /** Candidates that will be inspected/analyzed (excludes companies already in prospects). */
  toAnalyze: number;
  inspected: number;
  analyzed: number;
  failed: number;
}

export interface ResearchRequest extends ResearchCriteria {
  id: string;
  name: string;
  status: ResearchStatus;
  mode: ResearchMode;
  /** True for demo jobs. Kept for Phase 3 compatibility; equals mode === 'demo'. */
  isDemo: boolean;
  provider: ResearchProviderId | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Demo: rows generated. Real: verified companies kept after discovery and analysis. */
  resultCount: number;
  /** Real jobs only. */
  progress: RealResearchProgress | null;
  /** Turkish, user-facing. Set when the job failed or was stopped. */
  errorMessage: string | null;
  /** True when the user stopped the job; partial results are kept. */
  cancelled: boolean;
}

/** Where a result came from. */
export type ResearchResultSource = 'demo' | 'web';

export const RESEARCH_RESULT_SOURCES: Record<ResearchResultSource, string> = {
  demo: 'Demo veri',
  web: 'Web araştırması',
};

// ---------- Evidence ----------

/**
 * Provenance matters for verification:
 * - official_website / official_page: pages KITE itself fetched and inspected (first-party evidence).
 *   Only the server's website inspection creates these.
 * - official_page_unfetched: a page on the company's own domain that appeared in search results and
 *   was cited during discovery, but that KITE did not fetch. It counts as search evidence only.
 * - search_result / directory / publication / other: third-party sources seen in search results.
 */
export type EvidenceSourceType =
  | 'official_website'
  | 'official_page'
  | 'official_page_unfetched'
  | 'search_result'
  | 'directory'
  | 'publication'
  | 'other';

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSourceType, string> = {
  official_website: 'Resmi Website · İncelendi',
  official_page: 'Resmi Sayfa · İncelendi',
  official_page_unfetched: 'Resmi Sayfa · İncelenmedi',
  search_result: 'Arama Sonucu',
  directory: 'Rehber / Dizin',
  publication: 'Yayın',
  other: 'Diğer',
};

/** True only for pages KITE fetched and inspected itself. */
export function isInspectedEvidence(e: Pick<ResearchEvidence, 'sourceType'>): boolean {
  return e.sourceType === 'official_website' || e.sourceType === 'official_page';
}

export interface ResearchEvidence {
  /** Stable within one result, e.g. "e3". */
  id: string;
  url: string;
  title: string;
  sourceType: EvidenceSourceType;
  /** Short, neutral summary of what this source shows. Never instructions. */
  claim: string;
  retrievedAt: string;
}

// ---------- Verification ----------

export type VerificationStatus = 'verified' | 'partial' | 'unverified';

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  verified: 'Doğrulandı',
  partial: 'Kısmen Doğrulandı',
  unverified: 'Doğrulanamadı',
};

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
};

/**
 * What a location/sector verification rests on: a page KITE inspected, or only search evidence
 * (third-party results or unfetched pages of the company's own domain).
 */
export type VerificationBasis = 'inspected_site' | 'search_only';

export interface CompanyVerification {
  status: VerificationStatus;
  /** Verification confidence (how sure we are this is the right, matching company). Not opportunity confidence. */
  confidence: ConfidenceLevel;
  officialWebsiteVerified: boolean;
  locationVerified: boolean;
  sectorVerified: boolean;
  /** Set when locationVerified / sectorVerified is true. Missing on results stored before Phase 4.2. */
  locationBasis?: VerificationBasis | null;
  sectorBasis?: VerificationBasis | null;
  /** Turkish sentences describing what was verified, each backed by evidence. */
  verified: string[];
  /** Turkish sentences describing what could not be verified. */
  unverified: string[];
  evidenceIds: string[];
}

// ---------- Signals & service analysis ----------

export type SignalState = 'positive' | 'neutral' | 'negative' | 'unknown';

export const SIGNAL_STATE_LABELS: Record<SignalState, string> = {
  positive: 'Fırsatı destekliyor',
  neutral: 'Nötr',
  negative: 'Fırsatı zayıflatıyor',
  unknown: 'Bilinmiyor',
};

/** "check" = measured from the website HTML by code; "analysis" = model classification of evidence. */
export type SignalOrigin = 'check' | 'analysis' | 'not_inspected';

export interface ServiceSignal {
  key: string;
  label: string;
  state: SignalState;
  /** Turkish. Facts are stated as observed; inferences are worded as such. */
  reason: string;
  evidenceIds: string[];
  origin: SignalOrigin;
  weight: number;
}

export type Recommendation = 'primary' | 'secondary' | 'none';

export interface ServiceOpportunityAnalysis {
  service: ServiceKey;
  /** 0–100, computed by code from signals (see opportunityAnalysis.ts). */
  score: number;
  confidence: ConfidenceLevel;
  recommendation: Recommendation;
  /** Turkish one-line explanation. */
  reason: string;
  signals: ServiceSignal[];
  evidenceIds: string[];
}

export type CriteriaMatch = 'strong' | 'partial' | 'weak' | 'unknown';

export const CRITERIA_MATCH_LABELS: Record<CriteriaMatch, string> = {
  strong: 'Güçlü uyum',
  partial: 'Kısmi uyum',
  weak: 'Zayıf uyum',
  unknown: 'Bilinmiyor',
};

export interface CompanyAnalysis {
  /** Turkish summary for Berk. */
  summary: string;
  criteriaMatch: CriteriaMatch;
  criteriaNotes: string;
  /** Exclusions that could be checked, with outcome. Unverifiable ones are listed as unknown. */
  exclusionChecks: { exclusion: string; status: 'violated' | 'satisfied' | 'unknown'; evidenceIds: string[] }[];
  websiteInspected: boolean;
  /** Turkish, user-facing warnings such as "Bu şirketin websitesi incelenemedi." */
  warnings: string[];
}

export type ContactHintKind = 'email' | 'phone' | 'whatsapp' | 'contact_page' | 'person';

export interface ContactHint {
  kind: ContactHintKind;
  /** Email, phone, URL, or the person's name. Only values found on public pages. */
  value: string;
  role: string | null;
  evidenceIds: string[];
  confidence: ConfidenceLevel;
}

/** Measured website facts (from HTML/HTTP only; not a full technical audit). */
export interface WebsiteTechnicalSummary {
  inspected: boolean;
  finalUrl: string | null;
  https: boolean | null;
  httpStatus: number | null;
  redirected: boolean | null;
  responseTimeMs: number | null;
  hasViewport: boolean | null;
  hasTitle: boolean | null;
  hasMetaDescription: boolean | null;
  h1Count: number | null;
  formCount: number | null;
  ctaCount: number | null;
  hasBookingSignal: boolean | null;
  hasEcommerceSignal: boolean | null;
  hasWhatsApp: boolean | null;
  hasEmail: boolean | null;
  hasPhone: boolean | null;
  hasContactPage: boolean | null;
  socialLinks: string[];
  language: string | null;
  hasStructuredData: boolean | null;
  hasCanonical: boolean | null;
  /** Phase 12 observations (absent on research stored earlier). */
  languageVersions?: number | null;
  copyrightYear?: number | null;
  pagesInspected: { url: string; title: string; kind: string }[];
}

/** Per-result lifecycle. Demo rows are always "demo". */
export type ResultResearchStatus = 'demo' | 'discovered' | 'analyzed' | 'failed' | 'existing' | 'excluded';

export interface ResearchResult {
  id: string;
  researchRequestId: string;
  companyName: string;
  website: string | null;
  sector: string;
  city: string | null;
  country: string;
  source: ResearchResultSource;
  /** Primary service: the request's service for demo, the top-scoring service for real results. */
  service: ServiceKey;
  /** Overall opportunity score 0–100 (overallOpportunityScore). Null until a real result is analyzed. */
  opportunityScore: number | null;
  reason: string;
  companySize: CompanySize | null;
  confidence: ContactConfidence;
  selected: boolean;
  /** Matched an existing prospect when the job ran. The UI re-checks live (see findProspectMatch). */
  alreadyInProspects: boolean;
  /** Set when this result was transferred to Potansiyel Müşteriler. */
  transferredCompanyId: string | null;
  researchStatus: ResultResearchStatus;
  createdAt: string;

  // Real research only.
  /** Discovery-time assessment, kept so a failed analysis can be retried. */
  discovery?: { sectorFit: string; profileFit: CriteriaMatch; confidence: ConfidenceLevel };
  verification?: CompanyVerification;
  evidence?: ResearchEvidence[];
  analysis?: CompanyAnalysis;
  serviceOpportunities?: ServiceOpportunityAnalysis[];
  contactHints?: ContactHint[];
  technical?: WebsiteTechnicalSummary;
  /** Turkish, user-facing. Set when researchStatus is "failed". */
  analysisError?: string | null;
  /** Transparent ranking value (see rankResults). */
  rankScore?: number;
}

/** "Dubai Dental Klinik • CRM", "United States Luxury Real Estate • Google Ads". */
export function researchName(c: Pick<ResearchCriteria, 'service' | 'sector' | 'country' | 'city'>): string {
  const place = c.city?.trim() || c.country.trim();
  return `${place} ${c.sector.trim()} • ${SERVICES[c.service].label}`;
}

/**
 * Finds an existing company that is the same business as a candidate.
 * 1) Same website host (protocol, www, path and trailing slash ignored).
 * 2) Fallback: same normalized name AND same country (when both countries are known), so a
 *    similarly named business in another market is not merged. Countries are compared by their
 *    canonical value, so "AE", "UAE" and "United Arab Emirates" are the same market.
 * Branches on different domains/subdomains are treated as different companies.
 */
export function findProspectMatch<T extends Pick<Company, 'id' | 'name' | 'website'> & { country?: string }>(
  candidate: { name: string; website: string | null; country?: string | null },
  companies: readonly T[],
): T | null {
  const host = websiteHost(candidate.website);
  if (host) {
    const bySite = companies.find((c) => websiteHost(c.website) === host);
    if (bySite) return bySite;
  }
  const name = foldForSearch(candidate.name.trim());
  const country = candidate.country ? countryMatchKey(candidate.country) : null;
  return (
    companies.find((c) => {
      if (foldForSearch(c.name.trim()) !== name) return false;
      if (!country || !c.country) return true;
      return countryMatchKey(c.country) === country;
    }) ?? null
  );
}
