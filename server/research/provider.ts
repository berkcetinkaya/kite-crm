// The research domain talks to an LLM/search backend only through this adapter. Anthropic is the
// real implementation; the fixture provider implements the same interface for tests and offline QA.
import type { DiscoveredCandidate, ResearchErrorCode } from '../../src/domain/researchApi';
import type { ResearchCriteria, ResearchEvidence, ResearchProviderId, WebsiteTechnicalSummary } from '../../src/domain/research';
import type { ServiceKey } from '../../src/domain/services';
import type { PageExtract } from '../web/extract';

export class ProviderError extends Error {
  constructor(
    public readonly code: ResearchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface DiscoveryInput {
  criteria: ResearchCriteria;
  knownHosts: string[];
  targetCount: number;
  maxSearches: number;
  signal?: AbortSignal;
}

/** Raw provider output. Everything in `candidates` is untrusted until validated (discovery.ts). */
export interface DiscoveryOutput {
  candidates: unknown;
  /** URLs/titles the search tool actually returned; model-cited URLs are checked against these. */
  searchResults: { url: string; title: string }[];
  searchesUsed: number;
}

export interface SignalToClassify {
  service: ServiceKey;
  key: string;
  label: string;
  guide: string;
}

export interface AnalysisInput {
  criteria: ResearchCriteria;
  candidate: DiscoveredCandidate;
  evidence: ResearchEvidence[];
  pages: PageExtract[];
  technical: WebsiteTechnicalSummary;
  signals: SignalToClassify[];
  signal?: AbortSignal;
}

export interface ResearchProviderAdapter {
  readonly id: ResearchProviderId;
  discoverCompanies(input: DiscoveryInput): Promise<DiscoveryOutput>;
  /** Returns raw (untrusted) analysis JSON; validated by analysis.ts. */
  analyzeCompany(input: AnalysisInput): Promise<unknown>;
}
