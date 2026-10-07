// Mail context, shared prompt blocks and the Anthropic mail provider. Offline only: the fixture
// provider, or the Anthropic provider with an injected fetch. No network, no API usage, nothing sent.
// First contact generation itself (readiness, prompt v2, claim validation) is tested in
// server/outreachPrep/outreachPrep.test.ts and src/domain/mail/claims.test.ts.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Company } from '../../src/domain/company';
import { buildMailContext, type MailGenerateRequest } from '../../src/domain/mail/context';
import { buildPrepContext } from '../../src/domain/mail/prepContext';
import { validatePrepOutput } from '../../src/domain/mail/claims';
import { loadConfig } from '../config';
import { createApp } from '../app';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createAnthropicMailProvider } from './anthropicMailProvider';
import { createFixtureMailProvider } from './fixtureMailProvider';
import { composeFixturePrepared } from './fixturePrep';
import { MAIL_FIXTURES } from './fixtures';
import { mailUserPrompt } from './prompts';
import type { MailProviderAdapter } from './provider';

describe('mail context (used by follow ups and the earlier-draft panel)', () => {
  it('personalization is decided by code from the research', () => {
    expect(buildMailContext(MAIL_FIXTURES.noResearch).personalization).toBe('general');
    expect(buildMailContext(MAIL_FIXTURES.logisticsNoEvidence).personalization).toBe('general');
    expect(buildMailContext(MAIL_FIXTURES.travelInaccessible).personalization).toBe('cautious');
    expect(buildMailContext(MAIL_FIXTURES.dentalMultiLocation).personalization).toBe('specific');
    expect(buildMailContext(MAIL_FIXTURES.travelInaccessible).personalizationReasons.join(' ')).toContain('Analiz güveni düşük');
  });

  it('an "official" page is not treated as inspected when the website was not inspected', () => {
    const req: MailGenerateRequest = {
      ...MAIL_FIXTURES.travelInaccessible,
      research: { ...MAIL_FIXTURES.travelInaccessible.research!, evidence: [{ id: 'x1', url: 'https://cappadocia-sky.example/', title: 'Home', sourceType: 'official_website', claim: 'x' }], signals: [{ key: 'booking_flow', label: '', state: 'positive', reason: '', evidenceIds: ['x1'], origin: 'analysis' }] },
    };
    const ctx = buildMailContext(req);
    expect(ctx.companyEvidence.items[0].inspected).toBe(false);
    expect(ctx.companyEvidence.observations[0].strength).toBe('search');
  });

  it('unverified companies never get "seen on your website" wording', () => {
    const base = MAIL_FIXTURES.turkishHotel;
    const ctx = buildMailContext({ ...base, research: { ...base.research!, verificationStatus: 'unverified' } });
    expect(ctx.personalization).toBe('cautious');
    expect(ctx.companyEvidence.observations.every((o) => o.strength === 'search')).toBe(true);
  });

  it('custom sectors get generic or family guidance, never niche workflows', () => {
    expect(buildMailContext(MAIL_FIXTURES.customUnknown).sectorGuidance).toMatchObject({ source: 'generic', profileId: 'generic' });
    const inferred = buildMailContext({ ...MAIL_FIXTURES.customUnknown, company: { ...MAIL_FIXTURES.customUnknown.company, sector: 'Çocuk Diş Kliniği Zinciri' } });
    expect(inferred.sectorGuidance).toMatchObject({ source: 'family_inferred', profileId: 'family:health' });
    expect(inferred.sectorGuidance!.useCases.map((u) => u.id)).not.toContain('treatment_plans');
  });

  it('non CRM services use opportunity evidence, not sector intelligence', () => {
    for (const req of [MAIL_FIXTURES.aestheticMetaAds, MAIL_FIXTURES.websiteOpportunity]) expect(buildMailContext(req).sectorGuidance).toBeNull();
  });
});

describe('shared prompt blocks (follow ups)', () => {
  it('keeps company, evidence, guidance, service and personalization in separate parts', () => {
    const user = mailUserPrompt(buildMailContext(MAIL_FIXTURES.dentalMultiLocation));
    for (const tag of ['<company>', '<company_evidence>', '<sector_guidance>', '<service>', '<personalization>specific</personalization>']) expect(user).toContain(tag);
    expect(user).toContain('common use cases (general, NOT facts about this company)');
    expect(user.indexOf('<company_evidence>')).toBeLessThan(user.indexOf('<sector_guidance>'));
  });

  it('never asks for reasoning; no evidence is stated as none', () => {
    const user = mailUserPrompt(buildMailContext(MAIL_FIXTURES.noResearch));
    expect(user).not.toMatch(/step by step|chain of thought|explain your reasoning|think aloud/i);
    expect(user).toContain('<personalization>general</personalization>');
    expect(user).toContain('<company_evidence>\nnone\n</company_evidence>');
  });
});

const AT = '2026-10-07T09:00:00.000Z';
const lawFirm: Company = {
  id: 'cmp_law', name: 'Demir Hukuk', website: 'demir-hukuk.example', sector: 'Hukuk Bürosu', sectorId: null, city: 'Ankara', country: 'Türkiye',
  companySize: null, source: 'manual', owner: null, status: 'researched', opportunityScore: null, opportunities: [], contacts: [], notes: [], history: [],
  lastContactAt: null, nextAction: null, createdAt: AT, updatedAt: AT,
};
const prepCtx = () => buildPrepContext({ company: lawFirm, contact: null, service: 'crm', language: 'tr', tone: 'premium', angle: null, general: true, angles: [], cta: 'ideas_if_relevant', manualFacts: [], mode: 'full', current: null, withVariants: false });

describe('Anthropic mail provider (offline, injected fetch)', () => {
  afterEach(() => vi.unstubAllEnvs());
  type Call = { url: string; headers: Headers; body: string };
  const reply = (calls: Call[], status = 200, payload?: unknown): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body ?? '') });
      const ok = {
        id: 'msg_mail',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify(composeFixturePrepared(prepCtx())) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return new Response(JSON.stringify(payload ?? ok), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

  it('prepared drafts: only the KITE key and model, prompt v2 and the structured output schema', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'generic-key-must-not-be-used');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'generic-token-must-not-be-used');
    vi.stubEnv('ANTHROPIC_MODEL', 'generic-model-must-not-be-used');
    const calls: Call[] = [];
    const provider = createAnthropicMailProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }), { fetch: reply(calls) });
    const ctx = prepCtx();
    const raw = await provider.generatePrepared!(ctx);
    expect(validatePrepOutput(raw, ctx).ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith('https://api.anthropic.com/')).toBe(true);
    expect(calls[0].headers.get('x-api-key')).toBe('kite-test-key');
    expect(calls[0].headers.get('authorization')).toBeNull();
    const body = JSON.parse(calls[0].body);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(['subjectOptions', 'recommendedSubject', 'sections', 'claims', 'serviceReasoning', 'variants']);
    expect(JSON.stringify(body.system)).toContain('You write first contact emails for KITE Growth');
    expect(body.messages[0].content).toContain('<claim_sources>');
    expect(calls[0].body + JSON.stringify([...calls[0].headers.entries()])).not.toMatch(/generic-(key|token|model)-must-not-be-used/);
  });

  it('maps an Anthropic 400 to provider_rejected', async () => {
    const provider = createAnthropicMailProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }), {
      fetch: reply([], 400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }),
    });
    await expect(provider.generatePrepared!(prepCtx())).rejects.toMatchObject({ code: 'provider_rejected' });
  });

  it('the provider has no first contact method besides prompt v2', () => {
    const provider = createAnthropicMailProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }));
    expect(Object.keys(provider).sort()).toEqual(['generateFollowUp', 'generatePrepared', 'id', 'model']);
    expect(Object.keys(createFixtureMailProvider()).sort()).toEqual(['generateFollowUp', 'generatePrepared', 'id', 'model']);
  });
});

describe('HTTP routes', () => {
  let server: http.Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });
  async function start(mailProvider: MailProviderAdapter | null) {
    const config = loadConfig({ RESEARCH_PROVIDER: 'fixture' });
    server = http.createServer(createApp({ config, provider: null, mailProvider, fetchPage: fixtureFetcher }));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('reports the mail service status; the stateless Phase 5 generate endpoint is retired', async () => {
    let base = await start(createFixtureMailProvider());
    expect(await (await fetch(`${base}/api/mail/status`)).json()).toEqual({ ready: true, provider: 'fixture' });
    const gone = await fetch(`${base}/api/mail/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(MAIL_FIXTURES.turkishHotel) });
    expect(gone.status).toBe(410);
    expect(((await gone.json()) as { error: { code: string } }).error.code).toBe('gone');
    server!.close();
    base = await start(null);
    expect(await (await fetch(`${base}/api/mail/status`)).json()).toEqual({ ready: false, provider: null });
  });
});
