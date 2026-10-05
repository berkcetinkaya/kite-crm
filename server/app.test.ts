// Drives the HTTP handler on a local ephemeral port. The Anthropic provider gets an injected fetch
// that replays the live 400, so no request ever leaves the machine.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESEARCH_ERROR_MESSAGES } from '../src/domain/researchApi';
import { createApp } from './app';
import { loadConfig } from './config';
import { createAnthropicProvider } from './research/anthropicProvider';
import { fixtureFetcher } from './research/fixtureProvider';

const criteria = {
  service: 'crm',
  sector: 'Dental Clinic',
  country: 'United Arab Emirates',
  countryCode: 'AE',
  city: 'Dubai',
  companyCount: 3,
  criteria: '',
  exclusions: '',
};

const anthropic400: typeof fetch = (async () =>
  new Response(
    JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'tools.0.web_search_20260209: Country code AE is not supported.' } }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch;

let server: http.Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function start(): Promise<string> {
  const config = loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' });
  const provider = createAnthropicProvider(config, { fetch: anthropic400 });
  server = http.createServer(createApp({ config, provider, fetchPage: fixtureFetcher }));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const discover = (base: string, body: unknown) =>
  fetch(`${base}/api/research/discover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/research/discover error mapping', () => {
  it('reports an Anthropic 400 as provider_rejected (502), not as invalid user input', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await discover(await start(), { criteria, knownHosts: [] });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('provider_rejected');
    expect(body.error.message).toBe(RESEARCH_ERROR_MESSAGES.provider_rejected);
    expect(body.error.message).not.toBe(RESEARCH_ERROR_MESSAGES.invalid_request);
    // Provider details are logged server-side only, never sent to the browser.
    expect(JSON.stringify(body)).not.toContain('Country code AE');
  });

  it('still reports bad form input as invalid_request (400)', async () => {
    const res = await discover(await start(), { criteria: { ...criteria, companyCount: 0 }, knownHosts: [] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: unknown }).error).toEqual({ code: 'invalid_request', message: 'Araştırma isteği geçersiz.' });
  });
});
