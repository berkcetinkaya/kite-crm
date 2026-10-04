// Bounded public page fetcher: node:http(s) with a validating DNS lookup (no DNS-rebinding window),
// manual redirects (each target re-validated), timeout, size cap and HTML-only responses.
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import zlib from 'node:zlib';
import type { LookupFunction } from 'node:net';
import { assertPublicHttpUrl, isPublicIp, UnsafeUrlError } from './urlSafety';

export interface FetchLimits {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  redirected: boolean;
  contentType: string;
  html: string;
  /** Bytes were cut at maxBytes. */
  truncated: boolean;
  elapsedMs: number;
}

export type FetchErrorCode = 'unsafe_url' | 'timeout' | 'too_many_redirects' | 'not_html' | 'http_error' | 'network' | 'aborted';

export class FetchError extends Error {
  constructor(
    public readonly code: FetchErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/** A page fetcher; injectable so tests and the fixture provider never touch the network. */
export type PageFetcher = (url: string, signal?: AbortSignal) => Promise<FetchedPage>;

/** DNS lookup that refuses non-public answers. Used for every connection. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as unknown as LookupAddress[];
    const bad = list.find((a) => !isPublicIp(a.address));
    if (bad || list.length === 0) {
      return callback(Object.assign(new Error('Resolved to a non-public address'), { code: 'EUNSAFE' }), '', 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

const USER_AGENT = 'KITE-OS-Research/1.0 (company research; public pages only)';

function requestOnce(url: URL, limits: FetchLimits, signal?: AbortSignal) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }>(
    (resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        url,
        {
          method: 'GET',
          lookup: safeLookup,
          timeout: limits.timeoutMs,
          signal,
          headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
            'accept-encoding': 'gzip, deflate, br',
            'accept-language': 'en;q=0.8, *;q=0.5',
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            return resolve({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false });
          }
          const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip());
          else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
          else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());

          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          stream.on('data', (chunk: Buffer) => {
            if (truncated) return;
            size += chunk.length;
            if (size > limits.maxBytes) {
              truncated = true;
              chunks.push(chunk.subarray(0, chunk.length - (size - limits.maxBytes)));
              req.destroy();
              resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated });
              return;
            }
            chunks.push(chunk);
          });
          stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated }));
          stream.on('error', (e) => (truncated ? undefined : reject(e)));
        },
      );
      req.on('timeout', () => req.destroy(new FetchError('timeout', 'Request timed out')));
      req.on('error', reject);
      req.end();
    },
  );
}

export function createSafeFetcher(limits: FetchLimits): PageFetcher {
  return async (input, signal) => {
    const started = Date.now();
    let current: URL;
    try {
      current = assertPublicHttpUrl(input);
    } catch (e) {
      throw new FetchError('unsafe_url', e instanceof UnsafeUrlError ? e.reason : 'invalid');
    }
    for (let hop = 0; hop <= limits.maxRedirects; hop++) {
      let res;
      try {
        res = await requestOnce(current, limits, signal);
      } catch (e) {
        if (signal?.aborted) throw new FetchError('aborted', 'Aborted');
        if (e instanceof FetchError) throw e;
        const code = (e as { code?: string }).code;
        if (code === 'EUNSAFE') throw new FetchError('unsafe_url', 'resolved to non-public address');
        throw new FetchError('network', code ?? 'network error');
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.location;
        if (!location) throw new FetchError('http_error', 'Redirect without location', res.status);
        try {
          current = assertPublicHttpUrl(new URL(location, current).toString());
        } catch (e) {
          throw new FetchError('unsafe_url', e instanceof UnsafeUrlError ? `redirect: ${e.reason}` : 'redirect invalid');
        }
        continue;
      }
      if (res.status >= 400) throw new FetchError('http_error', `HTTP ${res.status}`, res.status);
      const contentType = String(res.headers['content-type'] ?? '');
      if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
        throw new FetchError('not_html', contentType);
      }
      return {
        url: input,
        finalUrl: current.toString(),
        status: res.status,
        redirected: hop > 0,
        contentType,
        html: res.body.toString('utf8'),
        truncated: res.truncated,
        elapsedMs: Date.now() - started,
      };
    }
    throw new FetchError('too_many_redirects', 'Too many redirects');
  };
}
