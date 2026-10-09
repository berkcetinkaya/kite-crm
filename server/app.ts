// HTTP handler for the research API (+ static files in production). Plain node:http keeps the
// server dependency-free; the handler is exported separately so tests can drive it directly.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  AnalyzeEvent,
  ResearchErrorCode,
  ResearchStatusResponse,
} from '../src/domain/researchApi';
import { REAL_RESEARCH_LIMITS, RESEARCH_ERROR_MESSAGES } from '../src/domain/researchApi';
import { searchBudget, type ServerConfig } from './config';
import { analyzeBatch } from './research/analysis';
import { runDiscovery } from './research/discovery';
import { ProviderError, type ResearchProviderAdapter } from './research/provider';
import { RequestValidationError, validateCandidates, validateCriteria, validateKnownHosts, validateFilters, validateJobId } from './research/validateRequest';
import type { PageFetcher } from './web/safeFetch';
import { abortOnClose, readJson, sendJson } from './http';
import { createDataRoutes } from './persistence/routes';
import type { PersistenceServices } from './persistence/services';
import { createOutreachRoutes } from './outreach/routes';
import type { OutreachService } from './outreach/service';
import { createFollowUpRoutes } from './followUp/routes';
import type { FollowUpPlanner } from './followUp/service';
import { createSalesRoutes } from './sales/routes';
import type { SalesService } from './sales/service';
import { createCustomerRoutes } from './customers/routes';
import type { CustomerServiceApi } from './customers/service';
import { createReportingRoutes } from './reporting/routes';
import type { ReportingService } from './reporting/service';
import { createTaskRoutes } from './tasks/routes';
import { createFinanceRoutes } from './finance/routes';
import type { KiteFinanceServiceApi, PersonalFinanceServiceApi } from './finance/service';
import type { TaskServiceApi } from './tasks/service';
import { createWorkRoutes } from './work/routes';
import { createDiscoveryRoutes } from './discovery/routes';
import { ProspectingError, type DiscoveryServiceApi } from './discovery/service';
import type { WorkServiceApi } from './work/service';
import { createOutreachPrepRoutes } from './outreachPrep/routes';
import { createSalesIntelligenceRoutes } from './salesIntelligence/routes';
import type { SalesIntelligenceService } from './salesIntelligence/service';
import type { OutreachPrepService } from './outreachPrep/service';
import type { MailStatusResponse } from '../src/domain/mail/api';
import type { MailProviderAdapter } from './mail/provider';

export interface AppDeps {
  config: ServerConfig;
  /** Null when the provider is not configured (missing API key). */
  provider: ResearchProviderAdapter | null;
  /** Mail draft generator (Phase 5). Null/absent when not configured. Never sends email. */
  mailProvider?: MailProviderAdapter | null;
  /** Persistence services (Phase 5.5). Null/absent when no database is configured. */
  data?: PersistenceServices | null;
  /** Gmail sending and reply tracking (Phase 6). Null/absent when no database is configured. */
  outreach?: OutreachService | null;
  /** Follow up planning (Phase 7). Null/absent when no database is configured. */
  followUps?: FollowUpPlanner | null;
  /** Meetings and proposals (Phase 8). Null/absent when no database is configured. */
  sales?: SalesService | null;
  /** Customers, services, onboarding and access (Phase 9). Null/absent when no database is configured. */
  customers?: CustomerServiceApi | null;
  reporting?: ReportingService | null;
  tasks?: TaskServiceApi | null;
  work?: WorkServiceApi | null;
  discovery?: DiscoveryServiceApi | null;
  /** Outreach readiness and prepared drafts (Phase 13). Never sends. */
  outreachPrep?: OutreachPrepService | null;
  /** Read-only sales intelligence (Phase 14). */
  salesIntelligence?: SalesIntelligenceService | null;
  /** KITE Finans and Berk (schema v9): two separate finance services. */
  finance?: { kite: KiteFinanceServiceApi; personal: PersonalFinanceServiceApi } | null;
  /** Browser QA controls; only passed in full fixture mode (config.testControls). */
  testRoutes?: ((req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>) | null;
  fetchPage: PageFetcher;
  /** Built frontend to serve (production). Omit in development (Vite serves the UI). */
  staticDir?: string;
}

const STATUS_FOR: Partial<Record<ResearchErrorCode, number>> = {
  not_configured: 503,
  invalid_request: 400,
  duplicate_request: 409,
  busy: 429,
  rate_limit: 429,
  auth: 502,
  unavailable: 503,
  timeout: 504,
  invalid_response: 502,
  provider_rejected: 502,
  refused: 502,
  daily_limit: 429,
  internal: 500,
};

function sendError(res: ServerResponse, code: ResearchErrorCode) {
  sendJson(res, STATUS_FOR[code] ?? 500, { error: { code, message: RESEARCH_ERROR_MESSAGES[code] } });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

export function createApp(deps: AppDeps) {
  const { config } = deps;
  const inFlight = new Set<string>();
  let discoveries = 0;
  let analyses = 0;
  const dataRoutes = createDataRoutes(deps.data ?? null, { maxBodyBytes: config.limits.maxDataBodyBytes });
  const outreachRoutes = createOutreachRoutes(deps.outreach ?? null, {
    maxBodyBytes: 16_000,
    secureCookie: (config.gmail.redirectUri ?? '').startsWith('https:'),
  });
  const followUpRoutes = createFollowUpRoutes(deps.followUps ?? null, deps.outreach ?? null, { maxBodyBytes: 32_000 });
  const salesRoutes = createSalesRoutes(deps.sales ?? null, { maxBodyBytes: 64_000 });
  const customerRoutes = createCustomerRoutes(deps.customers ?? null, { maxBodyBytes: 128_000 });
  const reportingRoutes = createReportingRoutes(deps.reporting ?? null);
  const taskRoutes = createTaskRoutes(deps.tasks ?? null, { maxBodyBytes: 32_000 });
  const financeRoutes = createFinanceRoutes(deps.finance ?? null, { maxBodyBytes: 32_000 });
  const workRoutes = createWorkRoutes(deps.work ?? null);
  const discoveryRoutes = createDiscoveryRoutes(deps.discovery ?? null, { maxBodyBytes: 512_000 });
  const outreachPrepRoutes = createOutreachPrepRoutes(deps.outreachPrep ?? null, { maxBodyBytes: 64_000 });
  const salesIntelligenceRoutes = createSalesIntelligenceRoutes(deps.salesIntelligence ?? null);

  const status = (): ResearchStatusResponse => ({
    ready: deps.provider !== null,
    provider: deps.provider?.id ?? null,
    reason: deps.provider ? null : 'not_configured',
    limits: { ...REAL_RESEARCH_LIMITS, maxCompanies: config.limits.maxCompanies } as typeof REAL_RESEARCH_LIMITS,
    maxSearchesPerDiscovery: config.limits.maxSearchesPerDiscovery,
    maxExtraPagesPerCompany: config.limits.maxExtraPagesPerCompany,
    ...(deps.discovery ? { realRuns: deps.discovery.realRuns() } : {}),
  });

  async function handleDiscover(req: IncomingMessage, res: ServerResponse) {
    if (!deps.provider) return sendError(res, 'not_configured');
    let criteria;
    let knownHosts;
    let filters;
    let jobId;
    try {
      const body = await readJson(req, config.limits.maxBodyBytes);
      const b = (body ?? {}) as Record<string, unknown>;
      criteria = validateCriteria(b.criteria, config.limits.maxCompanies);
      knownHosts = validateKnownHosts(b.knownHosts);
      filters = validateFilters(b.filters);
      jobId = validateJobId(b.jobId);
    } catch (e) {
      if (e instanceof RequestValidationError) return sendError(res, 'invalid_request');
      throw e;
    }
    const maxSearches = searchBudget(config, criteria.companyCount);
    // Phase 12: real (paid) runs must name their job so the daily cap and run details are recorded.
    if (deps.discovery && deps.provider.id !== 'fixture' && !jobId) return sendError(res, 'invalid_request');
    if (deps.discovery && jobId) {
      try {
        deps.discovery.beginRun({ jobId, providerId: deps.provider.id, filters, plannedMaxSearches: maxSearches, plannedMaxInspections: criteria.companyCount });
      } catch (e) {
        if (e instanceof ProspectingError) return sendError(res, e.code === 'daily_limit' ? 'daily_limit' : 'invalid_request');
        throw e;
      }
    }
    // One identical discovery at a time (protects against double submits), few concurrently overall.
    const key = createHash('sha256').update(JSON.stringify(criteria)).digest('hex');
    if (inFlight.has(key)) return sendError(res, 'duplicate_request');
    if (discoveries >= config.limits.maxConcurrentDiscoveries) return sendError(res, 'busy');
    inFlight.add(key);
    discoveries += 1;
    const controller = abortOnClose(req, res);
    try {
      const result = await runDiscovery(deps.provider, criteria, {
        targetCount: criteria.companyCount,
        maxSearches,
        knownHosts,
        filters,
        signal: controller.signal,
      });
      if (deps.discovery && jobId) deps.discovery.finishRun(jobId, { searchesUsed: result.searchesUsed, queries: result.queries ?? [] });
      if (result.candidates.length === 0) {
        return sendJson(res, 200, { ...result, notice: 'no_candidates' });
      }
      sendJson(res, 200, result);
    } catch (e) {
      if (controller.signal.aborted) return;
      const code = e instanceof ProviderError ? e.code : 'internal';
      console.warn('[research] discovery failed:', e instanceof Error ? e.message : e);
      sendError(res, code);
    } finally {
      inFlight.delete(key);
      discoveries -= 1;
    }
  }

  async function handleAnalyze(req: IncomingMessage, res: ServerResponse) {
    if (!deps.provider) return sendError(res, 'not_configured');
    let criteria;
    let candidates;
    try {
      const body = (await readJson(req, config.limits.maxBodyBytes)) as Record<string, unknown> | null;
      criteria = validateCriteria(body?.criteria, config.limits.maxCompanies);
      candidates = validateCandidates(body?.candidates, config.limits.analyzeBatchSize);
    } catch (e) {
      if (e instanceof RequestValidationError) return sendError(res, 'invalid_request');
      throw e;
    }
    if (analyses >= config.limits.maxConcurrentAnalyses) return sendError(res, 'busy');
    analyses += 1;
    const controller = abortOnClose(req, res);
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
    const emit = (event: AnalyzeEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      await analyzeBatch(
        { provider: deps.provider, fetchPage: deps.fetchPage, maxExtraPages: config.limits.maxExtraPagesPerCompany },
        criteria,
        candidates,
        emit,
        controller.signal,
      );
      emit({ type: 'done' });
    } catch (e) {
      console.error('[research] analyze batch failed:', e);
      emit({ type: 'error', code: 'internal', message: RESEARCH_ERROR_MESSAGES.internal });
    } finally {
      analyses -= 1;
      res.end();
    }
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse) {
    if (!deps.staticDir) return sendJson(res, 404, { error: 'not found' });
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const root = path.resolve(deps.staticDir);
    let file = path.resolve(root, `.${urlPath}`);
    if (!file.startsWith(root)) return sendJson(res, 403, { error: 'forbidden' });
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    } catch {
      file = path.join(root, 'index.html'); // SPA: the hash router handles the rest
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      sendJson(res, 404, { error: 'not found' });
    }
  }

  return async function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/research/status' && req.method === 'GET') return sendJson(res, 200, status());
      if (url.pathname === '/api/research/discover' && req.method === 'POST') return await handleDiscover(req, res);
      if (url.pathname === '/api/research/analyze' && req.method === 'POST') return await handleAnalyze(req, res);
      if (url.pathname === '/api/mail/status' && req.method === 'GET') {
        const mail = deps.mailProvider ?? null;
        return sendJson(res, 200, { ready: mail !== null, provider: mail?.id ?? null } satisfies MailStatusResponse);
      }
      // Retired (Phase 13): first contact drafts come only from the Phase 13 generation authority
      // (/api/outreach-prep, or the compatibility endpoint /api/mail/drafts/generate).
      if (url.pathname === '/api/mail/generate' && req.method === 'POST') return sendJson(res, 410, { error: { code: 'gone', message: 'Bu eski taslak servisi kaldırıldı. Taslaklar Mail & Takip > Hazırlık üzerinden hazırlanır.' } });
      if (await outreachRoutes(req, res, url)) return;
      if (await followUpRoutes(req, res, url)) return;
      if (await salesRoutes(req, res, url)) return;
      if (await customerRoutes(req, res, url)) return;
      if (await reportingRoutes(req, res, url)) return;
      if (await taskRoutes(req, res, url)) return;
      if (await financeRoutes(req, res, url)) return;
      if (await workRoutes(req, res, url)) return;
      if (await discoveryRoutes(req, res, url)) return;
      if (await outreachPrepRoutes(req, res, url)) return;
      if (await salesIntelligenceRoutes(req, res, url)) return;
      if (deps.testRoutes && config.testControls && (await deps.testRoutes(req, res, url))) return;
      if (await dataRoutes(req, res, url.pathname)) return;
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: { code: 'invalid_request', message: 'Not found' } });
      if (req.method === 'GET') return await serveStatic(req, res);
      sendJson(res, 405, { error: 'method not allowed' });
    } catch (e) {
      console.error('[server] unhandled error:', e);
      if (!res.headersSent) sendError(res, 'internal');
      else res.end();
    }
  };
}
