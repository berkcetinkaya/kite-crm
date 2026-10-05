// Server configuration from environment variables. The API key is read here only and never sent to
// the browser. Limits are server-side guardrails; the client mirrors some of them for early feedback.
//
// Key isolation: KITE uses its own KITE_ANTHROPIC_API_KEY. The generic ANTHROPIC_API_KEY (and
// ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL) are deliberately ignored so KITE never picks up, or
// interferes with, credentials that other tools such as Claude Code use.
import { REAL_RESEARCH_LIMITS } from '../src/domain/researchApi';

export type Effort = 'low' | 'medium' | 'high';

export interface ServerConfig {
  port: number;
  host: string;
  /** "anthropic" (default) or "fixture" (offline test data, clearly labelled in the UI). */
  provider: 'anthropic' | 'fixture';
  /** From KITE_ANTHROPIC_API_KEY only. */
  anthropicApiKey: string | null;
  anthropicModel: string;
  anthropicBaseUrl: string;
  discoveryEffort: Effort;
  analysisEffort: Effort;
  limits: {
    maxCompanies: number;
    maxSearchesPerDiscovery: number;
    analyzeBatchSize: number;
    maxExtraPagesPerCompany: number;
    maxPageBytes: number;
    fetchTimeoutMs: number;
    maxRedirects: number;
    providerTimeoutMs: number;
    maxBodyBytes: number;
    maxConcurrentDiscoveries: number;
    maxConcurrentAnalyses: number;
  };
}

const int = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const effort = (v: string | undefined, fallback: Effort): Effort =>
  v === 'low' || v === 'medium' || v === 'high' ? v : fallback;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: int(env.PORT, 8787, 1, 65535),
    host: env.HOST || '127.0.0.1',
    provider: env.RESEARCH_PROVIDER === 'fixture' ? 'fixture' : 'anthropic',
    anthropicApiKey: env.KITE_ANTHROPIC_API_KEY?.trim() || null,
    anthropicModel: env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5',
    anthropicBaseUrl: env.KITE_ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com',
    discoveryEffort: effort(env.RESEARCH_DISCOVERY_EFFORT, 'medium'),
    analysisEffort: effort(env.RESEARCH_ANALYSIS_EFFORT, 'medium'),
    limits: {
      maxCompanies: int(env.RESEARCH_MAX_COMPANIES, REAL_RESEARCH_LIMITS.maxCompanies, 1, REAL_RESEARCH_LIMITS.maxCompanies),
      maxSearchesPerDiscovery: int(env.RESEARCH_MAX_SEARCHES, 8, 1, 15),
      analyzeBatchSize: REAL_RESEARCH_LIMITS.analyzeBatchSize,
      maxExtraPagesPerCompany: int(env.RESEARCH_MAX_EXTRA_PAGES, 3, 0, 5),
      maxPageBytes: int(env.RESEARCH_MAX_PAGE_BYTES, 1_500_000, 50_000, 5_000_000),
      fetchTimeoutMs: int(env.RESEARCH_FETCH_TIMEOUT_MS, 8000, 1000, 20000),
      maxRedirects: 4,
      providerTimeoutMs: int(env.RESEARCH_PROVIDER_TIMEOUT_MS, 240_000, 30_000, 600_000),
      maxBodyBytes: 256_000,
      maxConcurrentDiscoveries: 2,
      maxConcurrentAnalyses: 4,
    },
  };
}

/** Number of searches allowed for one discovery: scales gently with the target, capped. */
export function searchBudget(config: ServerConfig, targetCount: number): number {
  return Math.min(config.limits.maxSearchesPerDiscovery, 3 + Math.ceil(targetCount / 4));
}
