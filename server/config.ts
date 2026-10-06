// Server configuration from environment variables. The API key is read here only and never sent to
// the browser. Limits are server-side guardrails; the client mirrors some of them for early feedback.
//
// Isolation: KITE uses its own KITE_ANTHROPIC_API_KEY and KITE_ANTHROPIC_MODEL. The generic
// ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL and ANTHROPIC_MODEL are deliberately
// ignored so KITE never picks up, or interferes with, settings that tools such as Claude Code use.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REAL_RESEARCH_LIMITS } from '../src/domain/researchApi';

/** Project root (one level above server/). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Default database file: data/kite.db in the project (git ignored). */
export const DEFAULT_DB_PATH = path.join(ROOT, 'data', 'kite.db');

/** Default encrypted Gmail credential file (git ignored). The key is never stored next to it. */
export const DEFAULT_GMAIL_TOKEN_PATH = path.join(ROOT, 'data', 'gmail-credentials.enc');

export interface GmailConfig {
  /** KITE_GMAIL_PROVIDER: "fixture" for offline tests, otherwise the real Google provider. */
  provider: 'google' | 'fixture';
  clientId: string | null;
  /** Server only: never sent to the browser. */
  clientSecret: string | null;
  redirectUri: string | null;
  tokenPath: string;
  /** KITE_CREDENTIALS_KEY (32 bytes, base64 or hex). Server only; never written to disk by KITE. */
  credentialsKey: string | null;
  sendTimeoutMs: number;
  /** Fixture only: simulated Gmail latency, so double clicks can be tested in the browser. */
  fixtureSendDelayMs: number;
}

export type Effort = 'low' | 'medium' | 'high';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

export interface ServerConfig {
  port: number;
  host: string;
  /** "anthropic" (default) or "fixture" (offline test data, clearly labelled in the UI). */
  provider: 'anthropic' | 'fixture';
  /** From KITE_ANTHROPIC_API_KEY only. */
  anthropicApiKey: string | null;
  /** From KITE_ANTHROPIC_MODEL only; defaults to DEFAULT_ANTHROPIC_MODEL. */
  anthropicModel: string;
  anthropicBaseUrl: string;
  /** SQLite database file (KITE_DB_PATH, relative paths resolve from the project root). */
  dbPath: string;
  /** Gmail sending and reply tracking (Phase 6). */
  gmail: GmailConfig;
  /**
   * Browser QA controls (movable clock, fixture replies). True ONLY with KITE_TEST_CONTROLS=1 AND the
   * fixture Gmail AND the fixture research/mail provider: never available with real Gmail or Anthropic.
   */
  testControls: boolean;
  /** Initial clock offset for test runs (KITE_TEST_CLOCK_OFFSET_MS), 0 unless testControls. */
  testClockOffsetMs: number;
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
    /** Persistence endpoints carry research results with evidence snapshots. */
    maxDataBodyBytes: number;
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
  const testControls = env.KITE_TEST_CONTROLS === '1' && env.KITE_GMAIL_PROVIDER === 'fixture' && env.RESEARCH_PROVIDER === 'fixture';
  return {
    testControls,
    testClockOffsetMs: testControls ? int(env.KITE_TEST_CLOCK_OFFSET_MS, 0, 0, 3_650 * 86_400_000) : 0,
    port: int(env.PORT, 8787, 1, 65535),
    host: env.HOST || '127.0.0.1',
    provider: env.RESEARCH_PROVIDER === 'fixture' ? 'fixture' : 'anthropic',
    anthropicApiKey: env.KITE_ANTHROPIC_API_KEY?.trim() || null,
    anthropicModel: env.KITE_ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    anthropicBaseUrl: env.KITE_ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com',
    dbPath: env.KITE_DB_PATH?.trim() ? path.resolve(ROOT, env.KITE_DB_PATH.trim()) : DEFAULT_DB_PATH,
    gmail: {
      provider: env.KITE_GMAIL_PROVIDER === 'fixture' ? 'fixture' : 'google',
      clientId: env.KITE_GMAIL_CLIENT_ID?.trim() || null,
      clientSecret: env.KITE_GMAIL_CLIENT_SECRET?.trim() || null,
      redirectUri: env.KITE_GMAIL_REDIRECT_URI?.trim() || null,
      tokenPath: env.KITE_GMAIL_TOKEN_PATH?.trim() ? path.resolve(ROOT, env.KITE_GMAIL_TOKEN_PATH.trim()) : DEFAULT_GMAIL_TOKEN_PATH,
      credentialsKey: env.KITE_CREDENTIALS_KEY?.trim() || null,
      sendTimeoutMs: int(env.KITE_GMAIL_SEND_TIMEOUT_MS, 30_000, 5_000, 120_000),
      fixtureSendDelayMs: int(env.KITE_GMAIL_FIXTURE_DELAY_MS, 400, 0, 10_000),
    },
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
      maxDataBodyBytes: 4_000_000,
      maxConcurrentDiscoveries: 2,
      maxConcurrentAnalyses: 4,
    },
  };
}

/** Number of searches allowed for one discovery: scales gently with the target, capped. */
export function searchBudget(config: ServerConfig, targetCount: number): number {
  return Math.min(config.limits.maxSearchesPerDiscovery, 3 + Math.ceil(targetCount / 4));
}
