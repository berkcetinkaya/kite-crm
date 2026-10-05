// Verifies which credentials and host the Anthropic provider actually sends, using an injected
// fetch. No network calls, no API usage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { createAnthropicProvider } from './anthropicProvider';
import type { AnalysisInput } from './provider';
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
