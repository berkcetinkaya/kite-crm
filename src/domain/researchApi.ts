// Contract between the browser and the research server (/api/research/*). Shared by both sides so
// the shapes cannot drift. No secrets or provider details ever cross this boundary.
import type { DiscoveryFilters } from './prospecting';
import type {
  CompanyAnalysis,
  CompanyVerification,
  ContactHint,
  ResearchCriteria,
  ResearchEvidence,
  ResearchProviderId,
  ServiceOpportunityAnalysis,
  WebsiteTechnicalSummary,
} from './research';
import type { CompanySize } from './company';

/** Server guardrails, also enforced client-side for early feedback. */
export const REAL_RESEARCH_LIMITS = {
  /** Hard cap on companies per real research job. */
  maxCompanies: 20,
  /** Companies per analyze request (client sends batches of this size). */
  analyzeBatchSize: 3,
  maxTextField: 1000,
  maxShortField: 120,
} as const;

export type ResearchErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'busy'
  | 'duplicate_request'
  | 'timeout'
  | 'unavailable'
  /** Our own request validation failed (bad form input). */
  | 'invalid_request'
  /** The AI provider rejected the request (e.g. Anthropic 400). Not a form input problem. */
  | 'provider_rejected'
  | 'invalid_response'
  | 'refused'
  | 'no_candidates'
  | 'website_unreachable'
  | 'cancelled'
  | 'server_unreachable'
  /** The configurable daily cap of real (paid) research runs was reached. */
  | 'daily_limit'
  | 'internal';

export const RESEARCH_ERROR_MESSAGES: Record<ResearchErrorCode, string> = {
  not_configured: 'Gerçek araştırmayı kullanmak için Anthropic API bağlantısı yapılandırılmalı.',
  auth: 'API bağlantısı doğrulanamadı.',
  rate_limit: 'Araştırma servisi şu anda yoğun. Biraz sonra tekrar dene.',
  busy: 'Şu anda başka bir araştırma işleniyor. Bitince tekrar dene.',
  duplicate_request: 'Aynı araştırma zaten işleniyor.',
  timeout: 'Araştırma zaman aşımına uğradı.',
  unavailable: 'Araştırma servisine şu anda ulaşılamıyor.',
  invalid_request: 'Araştırma isteği geçersiz.',
  provider_rejected: 'Araştırma servisi isteği reddetti (servis hatası). Biraz sonra tekrar dene; sorun sürerse yöneticine bildir.',
  invalid_response: 'Araştırma servisi beklenmeyen bir yanıt verdi.',
  refused: 'Araştırma servisi bu isteği işlemedi.',
  no_candidates: 'Arama kriterlerine uygun doğrulanmış şirket bulunamadı.',
  website_unreachable: 'Bu şirketin websitesi incelenemedi.',
  cancelled: 'Araştırma durduruldu.',
  server_unreachable: 'Araştırma sunucusuna ulaşılamıyor.',
  daily_limit: 'Bugünkü gerçek araştırma sınırına ulaşıldı. Yarın tekrar dene ya da sınırı sunucu ayarından değiştir.',
  internal: 'Araştırma sırasında beklenmeyen bir hata oluştu.',
};

export interface ResearchErrorBody {
  error: { code: ResearchErrorCode; message: string };
}

// ---------- GET /api/research/status ----------

export interface ResearchStatusResponse {
  /** True when the server can run real research. */
  ready: boolean;
  provider: ResearchProviderId | null;
  /** Set when not ready. */
  reason: ResearchErrorCode | null;
  limits: typeof REAL_RESEARCH_LIMITS;
  /** Upper bound of web searches per discovery (server config). */
  maxSearchesPerDiscovery?: number;
  /** Extra pages inspected per company after the homepage (server config). */
  maxExtraPagesPerCompany?: number;
  /** Real (paid) runs started today and the daily cap. Fixture runs are not counted. */
  realRuns?: { today: number; limit: number };
}

/** Searches planned for a discovery of `targetCount` companies (same formula as the server budget). */
export const plannedSearches = (targetCount: number, maxPerDiscovery: number): number => Math.min(maxPerDiscovery, 3 + Math.ceil(targetCount / 4));

// ---------- POST /api/research/discover ----------

export interface DiscoverRequest {
  criteria: ResearchCriteria;
  /** Website hosts already in Potansiyel Müşteriler, so discovery can prefer new companies. */
  knownHosts: string[];
  /** Phase 12: the job this discovery runs for (run details, daily cap) and its structured filters. */
  jobId?: string;
  filters?: DiscoveryFilters;
}

export interface DiscoveredCandidate {
  /** Server-issued id, stable for the job. */
  id: string;
  name: string;
  /** Official website origin, or '' when the run allows companies without a website. */
  website: string;
  city: string | null;
  country: string;
  sectorFit: string;
  profileFit: 'strong' | 'partial' | 'weak' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  /** Discovery evidence (search results / official pages), URLs validated server-side. */
  evidence: ResearchEvidence[];
}

export interface DiscoverResponse {
  candidates: DiscoveredCandidate[];
  /** Candidates the model proposed that failed server validation, with a Turkish reason. */
  rejected: { name: string; reason: string }[];
  searchesUsed: number;
  /** Search queries the provider reported (when available). */
  queries?: string[];
  /** Present when the search ran but no company passed validation. */
  notice?: 'no_candidates';
}

// ---------- POST /api/research/analyze (NDJSON stream) ----------

export interface AnalyzeRequest {
  criteria: ResearchCriteria;
  candidates: DiscoveredCandidate[];
}

export interface AnalyzedCompany {
  candidateId: string;
  companyName: string;
  /** Null when the company has no official website (allowed by the run's filters). */
  website: string | null;
  sector: string;
  city: string | null;
  country: string;
  companySize: CompanySize | null;
  verification: CompanyVerification;
  evidence: ResearchEvidence[];
  analysis: CompanyAnalysis;
  serviceOpportunities: ServiceOpportunityAnalysis[];
  overallScore: number;
  contactHints: ContactHint[];
  technical: WebsiteTechnicalSummary;
  /** True when a verifiable exclusion was violated; shown but not selectable. */
  excluded: boolean;
}

/** One JSON object per line. "inspected" and "analyzed"/"failed" are emitted per company as work completes. */
export type AnalyzeEvent =
  | { type: 'inspected'; candidateId: string; websiteOk: boolean }
  | { type: 'analyzed'; candidateId: string; result: AnalyzedCompany }
  | { type: 'failed'; candidateId: string; code: ResearchErrorCode; message: string }
  | { type: 'done' }
  | { type: 'error'; code: ResearchErrorCode; message: string };
