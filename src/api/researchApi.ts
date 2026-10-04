// Browser client for the research server. Only talks to our own /api; never to Anthropic.
import {
  RESEARCH_ERROR_MESSAGES,
  type AnalyzeEvent,
  type AnalyzeRequest,
  type DiscoverRequest,
  type DiscoverResponse,
  type ResearchErrorBody,
  type ResearchErrorCode,
  type ResearchStatusResponse,
} from '../domain/researchApi';

export class ResearchApiError extends Error {
  constructor(public readonly code: ResearchErrorCode) {
    super(RESEARCH_ERROR_MESSAGES[code]);
    this.name = 'ResearchApiError';
  }
}

async function toApiError(res: Response): Promise<ResearchApiError> {
  try {
    const body = (await res.json()) as ResearchErrorBody;
    if (body?.error?.code && body.error.code in RESEARCH_ERROR_MESSAGES) return new ResearchApiError(body.error.code);
  } catch {
    // Not our JSON (e.g. proxy error page when the server is not running).
  }
  return new ResearchApiError(res.status === 502 || res.status === 504 || res.status === 404 ? 'server_unreachable' : 'internal');
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new ResearchApiError('cancelled');
    throw new ResearchApiError('server_unreachable');
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

export interface ResearchApi {
  status(signal?: AbortSignal): Promise<ResearchStatusResponse>;
  discover(body: DiscoverRequest, signal?: AbortSignal): Promise<DiscoverResponse>;
  analyze(body: AnalyzeRequest, onEvent: (e: AnalyzeEvent) => void, signal?: AbortSignal): Promise<void>;
}

export const researchApi: ResearchApi = {
  async status(signal) {
    let res: Response;
    try {
      res = await fetch('/api/research/status', { signal });
    } catch {
      throw new ResearchApiError('server_unreachable');
    }
    if (!res.ok) throw await toApiError(res);
    const body = (await res.json().catch(() => null)) as ResearchStatusResponse | null;
    if (!body || typeof body.ready !== 'boolean') throw new ResearchApiError('server_unreachable');
    return body;
  },

  async discover(body, signal) {
    const res = await post('/api/research/discover', body, signal);
    return (await res.json()) as DiscoverResponse;
  },

  /** Reads the NDJSON stream and reports each event as soon as the server finishes that work. */
  async analyze(body, onEvent, signal) {
    const res = await post('/api/research/analyze', body, signal);
    if (!res.body) throw new ResearchApiError('invalid_response');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) onEvent(JSON.parse(line) as AnalyzeEvent);
        }
      }
    } catch (e) {
      if (signal?.aborted) throw new ResearchApiError('cancelled');
      if (e instanceof ResearchApiError) throw e;
      throw new ResearchApiError('server_unreachable');
    }
  },
};
