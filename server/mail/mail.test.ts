// Phase 5 mail generation tests. Offline only: the fixture provider, or the Anthropic provider
// with an injected fetch. No network, no API usage, nothing is sent.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMailContext, type MailGenerateRequest } from '../../src/domain/mail/context';
import { findProblemClaims, OBSERVATION_WORDING, validateMailOutput, wordCount, MAX_BODY_WORDS, type MailModelOutput } from '../../src/domain/mail/safety';
import { loadConfig } from '../config';
import { createApp } from '../app';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createAnthropicMailProvider } from './anthropicMailProvider';
import { composeFixtureMail, createFixtureMailProvider } from './fixtureMailProvider';
import { MAIL_FIXTURES } from './fixtures';
import { generateMailDraft, MailSafetyError } from './generate';
import { mailSystemPrompt, mailUserPrompt, MAIL_STYLE_RULES, MAIL_SYSTEM_RULES } from './prompts';
import type { MailProviderAdapter } from './provider';
import { validateMailRequest } from './validateRequest';

const fixture = createFixtureMailProvider();
const gen = (r: MailGenerateRequest) => generateMailDraft(fixture, r, { now: () => new Date('2026-10-05T10:00:00Z') });
const ALL = Object.entries(MAIL_FIXTURES) as [string, MailGenerateRequest][];

describe('fixture generation across sector families', () => {
  it.each(ALL)('%s: valid, concise draft with three subjects', async (_name, req) => {
    const d = await gen(req);
    expect(d.subjectOptions).toHaveLength(3);
    expect(new Set(d.subjectOptions).size).toBe(3);
    expect(d.body).toContain(req.company.name); // proper names are never translated
    expect(wordCount(d.body)).toBeLessThanOrEqual(MAX_BODY_WORDS);
    expect(d.body).not.toMatch(/[–—]| - /);
    expect(findProblemClaims(d.body)).toEqual([]);
    // Evidence refs only point at evidence that was provided for this company.
    const provided = new Set(req.research?.evidence.map((e) => e.id) ?? []);
    for (const ref of d.evidenceRefs) expect(provided.has(ref.id)).toBe(true);
  });

  it('writes Turkish for Türkiye prospects and English for international ones', async () => {
    const tr = await gen(MAIL_FIXTURES.turkishHotel);
    const en = await gen(MAIL_FIXTURES.dentalMultiLocation);
    expect(tr.body).toMatch(/^Merhaba /);
    expect(tr.body).toContain('İyi çalışmalar');
    expect(en.body).toMatch(/^Hi Lena Hart,/);
    expect(en.body).toContain('Best regards');
    // English mails never contain the Turkish sector label.
    expect(en.body).not.toContain('Diş Kliniği');
    expect(en.sectorContext.sectorLabel).toBe('Diş Kliniği');
  });

  it('strong evidence: combines a company observation, the service and sector use cases', async () => {
    const d = await gen(MAIL_FIXTURES.dentalMultiLocation);
    expect(d.generationNotes.personalization).toBe('specific');
    expect(d.generationNotes.companyObservation).toContain('more than one location');
    expect(d.evidenceRefs).toEqual([expect.objectContaining({ kind: 'company_evidence', id: 'w1', inspected: true })]);
    expect(d.sectorContext).toMatchObject({ kind: 'sector_guidance', profileId: 'dental_clinic', source: 'sector', familyLabel: 'Sağlık' });
    expect(d.sectorContext.useCasesUsed.map((u) => u.id)).toEqual(['treatment_plans', 'treatment_stages', 'payment_plans']);
    expect(d.body).toContain('In similar businesses, a CRM is typically used');
  });

  it('records provenance and prompt version on every draft', async () => {
    const d = await gen(MAIL_FIXTURES.lawFirm);
    expect(d.generationNotes).toMatchObject({ provider: 'fixture', model: null, promptVersion: 'mail-v1' });
    expect(d.generatedAt).toBe('2026-10-05T10:00:00.000Z');
  });
});

describe('hallucination protection', () => {
  it('a company with no useful evidence still gets an honest general draft', async () => {
    for (const req of [MAIL_FIXTURES.logisticsNoEvidence, MAIL_FIXTURES.noResearch]) {
      const d = await gen(req);
      expect(d.generationNotes.personalization).toBe('general');
      expect(d.generationNotes.companyObservation).toBeNull();
      expect(d.evidenceRefs).toEqual([]);
      expect(OBSERVATION_WORDING.test(d.body)).toBe(false);
      expect(d.generationNotes.personalizationReasons.length).toBeGreaterThan(0);
    }
  });

  it('inaccessible websites produce cautious personalization worded as search evidence', async () => {
    const d = await gen(MAIL_FIXTURES.travelInaccessible);
    expect(d.generationNotes.personalization).toBe('cautious');
    expect(d.body).toContain('doğrulayamadım');
    expect(d.body).not.toContain('Sitenize baktığımda');
    expect(d.evidenceRefs.every((e) => !e.inspected)).toBe(true);
    const en = await gen(MAIL_FIXTURES.realEstateSearchOnly);
    expect(en.body).toContain('could not confirm it on your website');
    expect(en.body).not.toContain('Looking at your website');
  });

  it('low confidence research produces less assertive wording', async () => {
    const strong = await gen(MAIL_FIXTURES.turkishHotel);
    const weak = await gen(MAIL_FIXTURES.travelInaccessible);
    expect(strong.body).toContain('somut bir fayda görüyoruz');
    expect(weak.body).not.toContain('somut bir fayda');
    expect(weak.body).toContain('fırsat olabileceğini düşündüm');
    const weakEn = await gen(MAIL_FIXTURES.realEstateSearchOnly);
    expect(weakEn.body).toContain('might be worth a look');
    expect(weakEn.body).not.toContain('we see a clear opportunity');
    expect(weak.generationNotes.personalizationReasons.join(' ')).toContain('Analiz güveni düşük');
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

  it('sector use cases are never converted into company facts', async () => {
    const d = await gen(MAIL_FIXTURES.turkishHotel);
    // Sector guidance appears only in its general framing sentence.
    const sectorSentence = d.body.split('\n\n').find((p) => p.includes('housekeeping'))!;
    expect(sectorSentence.startsWith('Benzer işletmelerde')).toBe(true);
    expect(sectorSentence).not.toMatch(/gördüm|sizin|sizde|otelinizde/);
    // The model output check rejects the forbidden pattern explicitly.
    const ctx = buildMailContext(MAIL_FIXTURES.turkishHotel);
    const bad: MailModelOutput = { ...composeFixtureMail(ctx), body: 'Merhaba,\n\nRandevu ve ödeme süreçlerinizin dağınık olduğunu gördük.\n\nİyi çalışmalar' };
    const v = validateMailOutput(bad, ctx);
    expect(v.ok).toBe(false);
    const badEn = { ...composeFixtureMail(buildMailContext(MAIL_FIXTURES.dentalMultiLocation)), body: 'Hi,\n\nI noticed your appointments and payments are scattered across tools.' };
    expect(validateMailOutput(badEn, buildMailContext(MAIL_FIXTURES.dentalMultiLocation)).ok).toBe(false);
  });

  it('unsupported company claims are rejected when there is no evidence', () => {
    const ctx = buildMailContext(MAIL_FIXTURES.noResearch);
    const good = composeFixtureMail(ctx);
    expect(validateMailOutput(good, ctx).ok).toBe(true);
    const invented = { ...good, body: `${good.body}\n\nI saw that you just opened a second clinic in Miami Beach.` };
    expect(validateMailOutput(invented, ctx)).toMatchObject({ ok: false });
    const withObservation = { ...good, companyObservation: 'You opened a second clinic.' };
    expect(validateMailOutput(withObservation, ctx)).toMatchObject({ ok: false });
    // An observation must cite evidence even when research exists.
    const strongCtx = buildMailContext(MAIL_FIXTURES.dentalMultiLocation);
    const uncited = { ...composeFixtureMail(strongCtx), evidenceRefsUsed: [] };
    expect(validateMailOutput(uncited, strongCtx)).toMatchObject({ ok: false });
  });

  it('custom sectors do not produce fabricated niche workflows', async () => {
    const unknown = await gen(MAIL_FIXTURES.customUnknown);
    expect(unknown.sectorContext).toMatchObject({ source: 'generic', profileId: 'generic', sectorLabel: 'Drone ile Tarım İlaçlama', familyLabel: null });
    expect(unknown.sectorContext.useCasesUsed.map((u) => u.id)).toEqual(['incoming_leads', 'contacts', 'sales_stages']);
    // No invented drone or farming workflows (the company name itself is fine).
    expect(unknown.body.replaceAll('Skyfield Agro Drones', '')).not.toMatch(/ilaçlama|uçuş|tarla|drone|hasat/i);

    const inferred = await gen({ ...MAIL_FIXTURES.customUnknown, company: { ...MAIL_FIXTURES.customUnknown.company, sector: 'Çocuk Diş Kliniği Zinciri' } });
    expect(inferred.sectorContext).toMatchObject({ source: 'family_inferred', profileId: 'family:health' });
    expect(inferred.sectorContext.useCasesUsed.map((u) => u.id)).not.toContain('treatment_plans');
  });

  it('non CRM services use opportunity evidence, not sector intelligence', async () => {
    for (const req of [MAIL_FIXTURES.aestheticMetaAds, MAIL_FIXTURES.websiteOpportunity]) {
      const d = await gen(req);
      expect(d.sectorContext.source).toBe('none');
      expect(d.sectorContext.useCasesUsed).toEqual([]);
      expect(d.evidenceRefs.length).toBe(1);
    }
  });
});

describe('output rules', () => {
  const ctx = buildMailContext(MAIL_FIXTURES.lawFirm);
  const good = composeFixtureMail(ctx);

  it('rejects hype phrases and spammy subjects', () => {
    expect(validateMailOutput({ ...good, body: `${good.body}\nThis will take your business to the next level.` }, ctx).ok).toBe(false);
    expect(validateMailOutput({ ...good, body: `${good.body}\nA real game changer.` }, ctx).ok).toBe(false);
    expect(validateMailOutput({ ...good, subjectOptions: ['FREE CRM audit', 'b', 'c'] }, ctx).ok).toBe(false);
    expect(validateMailOutput({ ...good, subjectOptions: ['Urgent: your CRM', 'b', 'c'] }, ctx).ok).toBe(false);
    expect(validateMailOutput({ ...good, subjectOptions: ['Quick idea!!', 'b', 'c'] }, ctx).ok).toBe(false);
    expect(validateMailOutput({ ...good, subjectOptions: ['Only one'] }, ctx).ok).toBe(false);
  });

  it('removes dash punctuation but keeps hyphenated words', () => {
    const v = validateMailOutput({ ...good, body: `${good.body}\nOne more thing — it is simple - and quick. E-commerce stays.` }, ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.output.body).not.toMatch(/[–—]| - /);
    expect(v.output.body).toContain('E-commerce');
    expect(v.warnings).toContain('Tire noktalaması virgüle çevrildi.');
  });

  it('drops evidence and sector ids that were not provided', () => {
    const v = validateMailOutput({ ...good, evidenceRefsUsed: [...good.evidenceRefsUsed, 'w99'], sectorBenefitsUsed: ['made_up', ...good.sectorBenefitsUsed] }, ctx);
    expect(v.ok && v.output.evidenceRefsUsed).toEqual(good.evidenceRefsUsed);
    expect(v.ok && v.output.sectorBenefitsUsed).toEqual(good.sectorBenefitsUsed);
  });

  it('rejects overly long mails', () => {
    expect(validateMailOutput({ ...good, body: 'word '.repeat(MAX_BODY_WORDS + 5) }, ctx).ok).toBe(false);
  });

  it('a provider that returns unsafe output is reported, never returned', async () => {
    const unsafe: MailProviderAdapter = { id: 'fixture', model: null, generate: async () => ({ ...good, body: 'You are losing patients because your follow ups are manual.' }) };
    await expect(generateMailDraft(unsafe, MAIL_FIXTURES.lawFirm)).rejects.toBeInstanceOf(MailSafetyError);
  });
});

describe('prompt architecture', () => {
  it('keeps system rules, style, language, evidence, guidance and service in separate parts', () => {
    const system = mailSystemPrompt('en');
    expect(system).toContain(MAIL_SYSTEM_RULES);
    expect(system).toContain(MAIL_STYLE_RULES);
    expect(system).toContain('Language: write the subjects and the email in natural, plain English');
    expect(mailSystemPrompt('tr')).toContain('natural Turkish');
    const user = mailUserPrompt(buildMailContext(MAIL_FIXTURES.dentalMultiLocation));
    for (const tag of ['<company>', '<company_evidence>', '<sector_guidance>', '<service>', '<personalization>specific</personalization>']) expect(user).toContain(tag);
    expect(user).toContain('common use cases (general, NOT facts about this company)');
    expect(user.indexOf('<company_evidence>')).toBeLessThan(user.indexOf('<sector_guidance>'));
  });

  it('never asks for reasoning and states the evidence rules', () => {
    const all = `${mailSystemPrompt('en')}\n${mailUserPrompt(buildMailContext(MAIL_FIXTURES.noResearch))}`;
    expect(all).not.toMatch(/step by step|chain of thought|explain your reasoning|think aloud/i);
    expect(all).toContain('It is not information about this company');
    expect(all).toContain('<personalization>general</personalization>');
    expect(all).toContain('<company_evidence>\nnone\n</company_evidence>');
    expect(all).not.toMatch(/[–—]/);
  });
});

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
        content: [{ type: 'text', text: JSON.stringify(composeFixtureMail(buildMailContext(MAIL_FIXTURES.lawFirm))) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return new Response(JSON.stringify(payload ?? ok), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

  it('uses only the KITE key and model, structured output and the split prompt', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'generic-key-must-not-be-used');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'generic-token-must-not-be-used');
    vi.stubEnv('ANTHROPIC_MODEL', 'generic-model-must-not-be-used');
    const calls: Call[] = [];
    const provider = createAnthropicMailProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }), { fetch: reply(calls) });
    const draft = await generateMailDraft(provider, MAIL_FIXTURES.lawFirm);
    expect(draft.generationNotes).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith('https://api.anthropic.com/')).toBe(true);
    expect(calls[0].headers.get('x-api-key')).toBe('kite-test-key');
    expect(calls[0].headers.get('authorization')).toBeNull();
    const body = JSON.parse(calls[0].body);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(
      expect.arrayContaining(['subjectOptions', 'body', 'companyObservation', 'serviceReasoning', 'sectorBenefitsUsed', 'evidenceRefsUsed', 'sectorProfileUsed']),
    );
    expect(JSON.stringify(body.system)).toContain('You write first contact emails for KITE Growth');
    expect(body.messages[0].content).toContain('<sector_guidance>');
    expect(calls[0].body + JSON.stringify([...calls[0].headers.entries()])).not.toMatch(/generic-(key|token|model)-must-not-be-used/);
  });

  it('maps an Anthropic 400 to provider_rejected', async () => {
    const provider = createAnthropicMailProvider(loadConfig({ KITE_ANTHROPIC_API_KEY: 'kite-test-key' }), {
      fetch: reply([], 400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }),
    });
    await expect(generateMailDraft(provider, MAIL_FIXTURES.lawFirm)).rejects.toMatchObject({ code: 'provider_rejected' });
  });
});

describe('request validation', () => {
  it('re-validates browser data: unsafe URLs, unknown signals and sector ids are dropped', () => {
    const r = validateMailRequest({
      ...MAIL_FIXTURES.lawFirm,
      company: { ...MAIL_FIXTURES.lawFirm.company, sectorId: 'not_a_sector', website: 'http://127.0.0.1/admin' },
      research: {
        ...MAIL_FIXTURES.lawFirm.research,
        evidence: [...MAIL_FIXTURES.lawFirm.research!.evidence, { id: 'x9', url: 'http://169.254.169.254/latest', title: 't', sourceType: 'official_page', claim: 'c' }],
        signals: [{ key: 'made_up_signal', state: 'positive', evidenceIds: ['w1'], origin: 'analysis' }],
      },
    });
    expect(r.company.sectorId).toBeNull();
    expect(r.company.website).toBeNull();
    expect(r.research!.evidence.map((e) => e.id)).not.toContain('x9');
    expect(r.research!.signals).toEqual([]);
  });

  it('rejects missing company, bad service and bad language', () => {
    expect(() => validateMailRequest({})).toThrow();
    expect(() => validateMailRequest({ ...MAIL_FIXTURES.lawFirm, service: 'cold_calls' })).toThrow();
    expect(() => validateMailRequest({ ...MAIL_FIXTURES.lawFirm, language: 'de' })).toThrow();
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
  const post = (base: string, body: unknown) => fetch(`${base}/api/mail/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('generates a draft with the fixture provider and reports status', async () => {
    const base = await start(fixture);
    expect(await (await fetch(`${base}/api/mail/status`)).json()).toEqual({ ready: true, provider: 'fixture' });
    const res = await post(base, MAIL_FIXTURES.turkishHotel);
    expect(res.status).toBe(200);
    const d = (await res.json()) as { subjectOptions: string[]; body: string };
    expect(d.subjectOptions).toHaveLength(3);
    expect(d.body).toContain('Kaleiçi Taş Konak');
  });

  it('reports not configured, invalid requests and unsafe output distinctly', async () => {
    let base = await start(null);
    expect((await post(base, MAIL_FIXTURES.turkishHotel)).status).toBe(503);
    server!.close();
    base = await start(fixture);
    const bad = await post(base, { company: {} });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('invalid_request');
    server!.close();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    base = await start({ id: 'fixture', model: null, generate: async () => ({ ...composeFixtureMail(buildMailContext(MAIL_FIXTURES.noResearch)), body: 'I noticed your bookings are messy.' }) });
    const unsafe = await post(base, MAIL_FIXTURES.noResearch);
    expect(unsafe.status).toBe(422);
    const e = (await unsafe.json()) as { error: { code: string; problems: string[] } };
    expect(e.error.code).toBe('unsafe_output');
    expect(e.error.problems.length).toBeGreaterThan(0);
  });
});
