import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESEARCH_ERROR_MESSAGES } from '../domain/researchApi';
import { ResearchApiError, researchApi } from './researchApi';

const request = {
  criteria: { service: 'crm' as const, sector: 'Dental Clinic', country: 'United Arab Emirates', countryCode: 'AE', city: 'Dubai', companyCount: 3, criteria: '', exclusions: '' },
  knownHosts: [],
};

function reply(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
}

afterEach(() => vi.unstubAllGlobals());

describe('research API client error mapping', () => {
  it('surfaces a provider rejection with the provider message, not the form-validation one', async () => {
    reply(502, { error: { code: 'provider_rejected', message: RESEARCH_ERROR_MESSAGES.provider_rejected } });
    const error = await researchApi.discover(request).catch((e) => e);
    expect(error).toBeInstanceOf(ResearchApiError);
    expect(error.code).toBe('provider_rejected');
    expect(error.message).toBe(RESEARCH_ERROR_MESSAGES.provider_rejected);
    expect(error.message).not.toBe('Araştırma isteği geçersiz.');
  });

  it('keeps invalid_request for form validation failures', async () => {
    reply(400, { error: { code: 'invalid_request', message: 'Araştırma isteği geçersiz.' } });
    await expect(researchApi.discover(request)).rejects.toMatchObject({ code: 'invalid_request', message: 'Araştırma isteği geçersiz.' });
  });

  it('treats a 502 without our error body as an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad Gateway', { status: 502 })));
    await expect(researchApi.discover(request)).rejects.toMatchObject({ code: 'server_unreachable' });
  });
});

describe('Turkish error messages', () => {
  it('has a distinct Turkish provider message', () => {
    expect(RESEARCH_ERROR_MESSAGES.provider_rejected).toMatch(/servis/);
    expect(RESEARCH_ERROR_MESSAGES.provider_rejected).not.toBe(RESEARCH_ERROR_MESSAGES.invalid_request);
  });
});
