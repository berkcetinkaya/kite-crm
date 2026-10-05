// Verifies which credentials and host the Anthropic provider actually sends, using an injected
// fetch. No network calls, no API usage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import Anthropic from '@anthropic-ai/sdk';
import { COUNTRIES } from '../../src/domain/locations';
import { createAnthropicProvider, mapAnthropicError } from './anthropicProvider';
import { ProviderError, type AnalysisInput, type DiscoveryInput } from './provider';
import { DISCOVERY_TOOL_NAME } from './schemas';
import { WEB_SEARCH_LOCATION_COUNTRIES } from './webSearchLocation';
import { EMPTY_TECHNICAL } from '../web/inspect';

const input: AnalysisInput = {
  criteria: {
    service: 'crm',
    sector: 'Dental Clinic',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    city: 'Dubai',
    companyCount: 3,
    criteria: '',
    exclusions: '',
  },
  candidate: {
    id: 'c1',
    name: 'Test Clinic',
    website: 'https://test-clinic.example/',
    city: 'Dubai',
    country: 'United Arab Emirates',
    sectorFit: '',
    profileFit: 'unknown',
    confidence: 'low',
    evidence: [],
  },
  evidence: [],
  pages: [],
  technical: EMPTY_TECHNICAL,
  signals: [],
};

function fakeFetch(calls: { url: string; headers: Headers; body: string }[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body ?? '') });
    const message = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: '{"summary":"ok","signals":[]}' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

afterEach(() => vi.unstubAllEnvs());

describe('Anthropic provider credential isolation', () => {
  it('sends only KITE_ANTHROPIC_API_KEY, even when generic Anthropic env vars are set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'generic-key-must-not-be-used');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'generic-token-must-not-be-used');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://generic-proxy.invalid');

    const calls: { url: string; headers: Headers; body: string }[] = [];
    const config = loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' });
    const provider = createAnthropicProvider(config, { fetch: fakeFetch(calls) });
    await expect(provider.analyzeCompany(input)).resolves.toEqual({ summary: 'ok', signals: [] });

    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith('https://api.anthropic.com/')).toBe(true);
    expect(calls[0].headers.get('x-api-key')).toBe('kite-test-key');
    expect(calls[0].headers.get('authorization')).toBeNull();
    const all = JSON.stringify([...calls[0].headers.entries()]);
    expect(all).not.toContain('generic-key-must-not-be-used');
    expect(all).not.toContain('generic-token-must-not-be-used');
  });

  it('sends the default model and ignores the generic ANTHROPIC_MODEL', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'generic-model-must-not-be-used');
    const calls: { url: string; headers: Headers; body: string }[] = [];
    const provider = createAnthropicProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }), { fetch: fakeFetch(calls) });
    await provider.analyzeCompany(input);
    expect(JSON.parse(calls[0].body).model).toBe('claude-opus-5-5');
    expect(calls[0].body).not.toContain('generic-model-must-not-be-used');
  });

  it('sends the model from KITE_ANTHROPIC_MODEL', async () => {
    const calls: { url: string; headers: Headers; body: string }[] = [];
    const config = loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key', KITE_ANTHROPIC_MODEL: 'claude-sonnet-5-5' });
    await createAnthropicProvider(config, { fetch: fakeFetch(calls) }).analyzeCompany(input);
    expect(JSON.parse(calls[0].body).model).toBe('claude-sonnet-5-5');
  });

  it('refuses to build a provider without the KITE key', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'generic-key');
    expect(() => createAnthropicProvider(loadConfig({ ANTHROPIC_API_KEY: 'generic-key' }))).toThrow('KITE_ANTHROPIC_API_KEY');
  });
});

type Call = { url: string; headers: Headers; body: string };

/** Answers every request with a discovery submission (one tool_use block). */
function discoveryFetch(calls: Call[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body ?? '') });
    const message = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'tool_use', id: 'toolu_1', name: DISCOVERY_TOOL_NAME, input: { companies: [] } }],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

/** Replies with the exact 400 Anthropic returned in the Phase 4.1 live smoke test. */
function rejectingFetch(calls: Call[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body ?? '') });
    const error = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'tools.0.web_search_20260209: Country code AE is not supported.' },
    };
    return new Response(JSON.stringify(error), { status: 400, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const discoveryInput: DiscoveryInput = { criteria: input.criteria, knownHosts: [], targetCount: 3, maxSearches: 4 };

describe('Anthropic discovery: web search location', () => {
  it('does not send user_location for an AE / Dubai request, but still targets Dubai in the prompt', async () => {
    const calls: Call[] = [];
    const provider = createAnthropicProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }), { fetch: discoveryFetch(calls) });
    await expect(provider.discoverCompanies(discoveryInput)).resolves.toMatchObject({ candidates: { companies: [] } });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].body);
    const webSearch = body.tools.find((t: { name: string }) => t.name === 'web_search');
    expect(webSearch).toMatchObject({ type: 'web_search_20260209', max_uses: 4 });
    expect(webSearch).not.toHaveProperty('user_location');
    expect(calls[0].body).not.toContain('user_location');

    // Country and city still reach the model through the prompt.
    const prompt: string = body.messages[0].content;
    expect(prompt).toContain('Country: United Arab Emirates (AE)');
    expect(prompt).toContain('City: Dubai');
    expect(prompt).toContain('Sector: Dental Clinic');
    expect(JSON.stringify(body.system)).toContain('include the city');
  });

  it('never sends user_location for a country outside the allowlist, for every KITE market', async () => {
    for (const country of COUNTRIES) {
      const calls: Call[] = [];
      const provider = createAnthropicProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }), { fetch: discoveryFetch(calls) });
      const criteria = { ...input.criteria, country: country.name, countryCode: country.code, city: country.cities[0] ?? null };
      await provider.discoverCompanies({ ...discoveryInput, criteria });
      const webSearch = JSON.parse(calls[0].body).tools.find((t: { name: string }) => t.name === 'web_search');
      if (WEB_SEARCH_LOCATION_COUNTRIES.has(country.code)) expect(webSearch.user_location.country).toBe(country.code);
      else expect(webSearch, country.code).not.toHaveProperty('user_location');
      expect(JSON.parse(calls[0].body).messages[0].content).toContain(`Country: ${country.name} (${country.code})`);
    }
  });
});

describe('Anthropic error mapping', () => {
  const headers = new Headers();
  const err = (status: number, message = 'x') => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, headers);

  it('maps an Anthropic 400 to provider_rejected, never to the form-validation invalid_request', () => {
    const mapped = mapAnthropicError(err(400, 'tools.0.web_search_20260209: Country code AE is not supported.'));
    expect(mapped).toBeInstanceOf(ProviderError);
    expect(mapped.code).toBe('provider_rejected');
    expect(mapped.code).not.toBe('invalid_request');
    expect(mapped.message).toContain('Country code AE is not supported');
  });

  it('maps other client-side rejections to provider_rejected and keeps the specific codes', () => {
    expect(mapAnthropicError(err(404)).code).toBe('provider_rejected');
    expect(mapAnthropicError(err(413)).code).toBe('provider_rejected');
    expect(mapAnthropicError(err(422)).code).toBe('provider_rejected');
    expect(mapAnthropicError(err(401)).code).toBe('auth');
    expect(mapAnthropicError(err(403)).code).toBe('auth');
    expect(mapAnthropicError(err(429)).code).toBe('rate_limit');
    expect(mapAnthropicError(err(500)).code).toBe('unavailable');
    expect(mapAnthropicError(err(529)).code).toBe('unavailable');
  });

  it('turns a live-style 400 during discovery into provider_rejected without retrying', async () => {
    const calls: Call[] = [];
    const provider = createAnthropicProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }), { fetch: rejectingFetch(calls) });
    const error = await provider.discoverCompanies(discoveryInput).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe('provider_rejected');
    expect(calls).toHaveLength(1);
  });

  it('turns a 400 during analysis into provider_rejected', async () => {
    const provider = createAnthropicProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }), { fetch: rejectingFetch([]) });
    await expect(provider.analyzeCompany(input)).rejects.toMatchObject({ code: 'provider_rejected' });
  });
});
