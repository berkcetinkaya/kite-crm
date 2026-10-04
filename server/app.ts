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
import { RequestValidationError, validateCandidates, validateCriteria, validateKnownHosts } from './research/validateRequest';
import type { PageFetcher } from './web/safeFetch';

export interface AppDeps {
  config: ServerConfig;
  /** Null when the provider is not configured (missing API key). */
  provider: ResearchProviderAdapter | null;
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
  refused: 502,
  internal: 500,
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, code: ResearchErrorCode) {
  sendJson(res, STATUS_FOR[code] ?? 500, { error: { code, message: RESEARCH_ERROR_MESSAGES[code] } });
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new RequestValidationError('body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new RequestValidationError('invalid JSON');
  }
}

/** Aborts provider/fetch work when the client goes away (cancel button, closed tab). */
function abortOnClose(req: IncomingMessage, res: ServerResponse): AbortController {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  req.on('aborted', () => controller.abort());
  return controller;
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

  const status = (): ResearchStatusResponse => ({
    ready: deps.provider !== null,
    provider: deps.provider?.id ?? null,
    reason: deps.provider ? null : 'not_configured',
    limits: { ...REAL_RESEARCH_LIMITS, maxCompanies: config.limits.maxCompanies } as typeof REAL_RESEARCH_LIMITS,
  });

  async function handleDiscover(req: IncomingMessage, res: ServerResponse) {
    if (!deps.provider) return sendError(res, 'not_configured');
    let criteria;
    let knownHosts;
    try {
      const body = await readJson(req, config.limits.maxBodyBytes);
      const b = (body ?? {}) as Record<string, unknown>;
      criteria = validateCriteria(b.criteria, config.limits.maxCompanies);
      knownHosts = validateKnownHosts(b.knownHosts);
    } catch (e) {
      if (e instanceof RequestValidationError) return sendError(res, 'invalid_request');
      throw e;
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
        maxSearches: searchBudget(config, criteria.companyCount),
        knownHosts,
        signal: controller.signal,
      });
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
