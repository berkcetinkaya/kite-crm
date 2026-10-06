// Phase 7 follow up generation: deterministic fixture outputs, the follow up safety validator and the
// Gmail threading construction. No network and no Anthropic: Google is a fake fetch.
import { describe, expect, it } from 'vitest';
import { buildMailContext, type MailGenerateRequest } from '../../src/domain/mail/context';
import { buildFollowUpContext, type FollowUpContext, type FollowUpPreviousMessage } from '../../src/domain/mail/followUpContext';
import { MAX_FOLLOW_UP_WORDS, validateFollowUpOutput } from '../../src/domain/mail/followUpSafety';
import { wordCount } from '../../src/domain/mail/safety';
import { createGmailRestApi } from '../gmail/google';
import { buildMime, threadHeaders } from '../gmail/message';
import { composeFixtureFollowUp } from './fixtureFollowUp';
import { composeFixtureMail } from './fixtureMailProvider';
import { MAIL_FIXTURES } from './fixtures';
import { createFixtureMailProvider } from './fixtureMailProvider';
import { generateFollowUpDraft, MailSafetyError } from './generate';
import { followUpSystemPrompt, followUpUserPrompt } from './followUpPrompts';

/** Runs a whole fixture conversation: the original mail, then steps 1..3 each seeing the earlier ones. */
function conversation(req: MailGenerateRequest) {
  const base = buildMailContext(req);
  const original = composeFixtureMail(base);
  const prev: FollowUpPreviousMessage[] = [
    { ref: 'original', stepNumber: 0, body: original.body, sentAt: '2026-10-01T09:00:00.000Z', angle: null, companyObservation: original.companyObservation, evidenceRefsUsed: original.evidenceRefsUsed, sectorBenefitsUsed: original.sectorBenefitsUsed },
  ];
  const steps: { ctx: FollowUpContext; out: ReturnType<typeof composeFixtureFollowUp> }[] = [];
  for (const stepNumber of [1, 2, 3]) {
    const ctx = buildFollowUpContext({ base, stepNumber, maxSteps: 3, subject: original.subjectOptions[0], previousMessages: prev, now: `2026-10-${String(4 + stepNumber * 5).padStart(2, '0')}T09:00:00.000Z` });
    const out = composeFixtureFollowUp(ctx);
    steps.push({ ctx, out });
    prev.push({ ref: `followup_${stepNumber}`, stepNumber, body: out.body, sentAt: ctx.outreachHistory.lastSentAt.replace('09:00', '10:00'), angle: out.followUpAngle, companyObservation: out.companyObservation, evidenceRefsUsed: out.evidenceRefsUsed, sectorBenefitsUsed: out.sectorBenefitsUsed });
  }
  return { base, original, steps };
}

const CASES: [string, MailGenerateRequest][] = [
  ['CRM dental clinic, English, strong evidence', MAIL_FIXTURES.dentalMultiLocation],
  ['hotel, Turkish, strong evidence', MAIL_FIXTURES.turkishHotel],
  ['real estate, English, search sources only (cautious)', MAIL_FIXTURES.realEstateSearchOnly],
  ['non CRM service (Meta Ads), English', MAIL_FIXTURES.aestheticMetaAds],
  ['non CRM service (website), Turkish', MAIL_FIXTURES.websiteOpportunity],
  ['weak evidence logistics, Turkish', MAIL_FIXTURES.logisticsNoEvidence],
  ['no research, English', MAIL_FIXTURES.noResearch],
  ['custom unknown sector, Turkish', MAIL_FIXTURES.customUnknown],
];

describe('fixture follow ups', () => {
  it.each(CASES)('%s: three valid, short, different steps', (_name, req) => {
    const { steps, base } = conversation(req);
    for (const { ctx, out } of steps) {
      const v = validateFollowUpOutput(out, ctx);
      expect(v.ok, v.ok ? '' : v.problems.join(' | ')).toBe(true);
      const n = wordCount(out.body);
      expect(n).toBeGreaterThanOrEqual(25);
      expect(n).toBeLessThanOrEqual(MAX_FOLLOW_UP_WORDS);
      expect(out.stepNumber).toBe(ctx.stepNumber);
      expect(out.previousMessagesConsidered).toEqual(ctx.previousMessages.map((m) => m.ref));
      expect(out.body).not.toMatch(/[–—]|\s-\s/);
      if (base.personalization === 'general') expect(out.companyObservation).toBeNull();
    }
    const bodies = steps.map((s) => s.out.body);
    expect(new Set(bodies).size).toBe(3);
    expect(steps.map((s) => s.out.followUpAngle)).toEqual(['gentle_reminder', expect.any(String), 'close_loop']);
    expect(steps[1].out.followUpAngle).not.toBe('gentle_reminder');
    // Later steps do not repeat step 1's sentences.
    const first = new Set(bodies[0].split(/(?<=[.!?])\s+|\n+/).filter((s) => s.split(' ').length >= 6));
    for (const b of bodies.slice(1)) for (const s of b.split(/(?<=[.!?])\s+|\n+/)) expect(first.has(s)).toBe(false);
  });

  it('step 2 for a CRM sector uses a sector use case the first email did not use', () => {
    const { original, steps } = conversation(MAIL_FIXTURES.turkishHotel);
    const angle = steps[1].out.sectorBenefitsUsed;
    expect(angle).toHaveLength(1);
    expect(original.sectorBenefitsUsed).not.toContain(angle[0]);
  });

  it('strong evidence may reuse a previously used observation once; weak evidence stays general', () => {
    const strong = conversation(MAIL_FIXTURES.dentalMultiLocation).steps;
    expect(strong[1].out.companyObservation).not.toBeNull();
    expect(strong[1].out.evidenceRefsUsed.length).toBeGreaterThan(0);
    expect(strong[0].out.companyObservation).toBeNull();
    const weak = conversation(MAIL_FIXTURES.logisticsNoEvidence).steps;
    expect(weak.every((s) => s.out.companyObservation === null && s.out.evidenceRefsUsed.length === 0)).toBe(true);
  });

  it('the final step makes it easy not to continue (Turkish and English)', () => {
    expect(conversation(MAIL_FIXTURES.turkishHotel).steps[2].out.body).toMatch(/burada bırakabilirim/);
    expect(conversation(MAIL_FIXTURES.dentalMultiLocation).steps[2].out.body).toMatch(/leave it here/);
  });

  it('pipeline returns provenance and no subject', async () => {
    const { steps } = conversation(MAIL_FIXTURES.dentalMultiLocation);
    const r = await generateFollowUpDraft(createFixtureMailProvider(), steps[1].ctx);
    expect(r).not.toHaveProperty('subjectOptions');
    expect(r.generationNotes.followUp).toMatchObject({ stepNumber: 2, previousMessagesConsidered: ['original', 'followup_1'] });
    expect(r.generationNotes.promptVersion).toBe('followup-v1');
    expect(r.evidenceRefs.every((e) => e.kind === 'company_evidence')).toBe(true);
  });

  it('the prompt keeps evidence and guidance separate and includes the conversation', () => {
    const { steps } = conversation(MAIL_FIXTURES.dentalMultiLocation);
    const user = followUpUserPrompt(steps[2].ctx);
    expect(user).toContain('<company_evidence>');
    expect(user).toContain('<sector_guidance>');
    expect(user).toContain('<conversation>');
    expect(user).toContain('followup_2');
    expect(followUpSystemPrompt(steps[2].ctx)).toMatch(/close the loop/);
    expect(followUpSystemPrompt(steps[0].ctx)).not.toMatch(/subjects/);
  });
});

describe('follow up safety validator', () => {
  const { steps } = conversation(MAIL_FIXTURES.logisticsNoEvidence); // general personalization
  const ctx = steps[0].ctx;
  const good = steps[0].out;
  const problems = (patch: Record<string, unknown>) => {
    const v = validateFollowUpOutput({ ...good, ...patch }, ctx);
    return v.ok ? [] : v.problems;
  };
  const withBody = (sentence: string) => problems({ body: `Merhaba,\n\n${sentence}\n\nİyi çalışmalar,\nBerk Çetinkaya\nKITE Growth` });

  it('accepts the fixture output', () => expect(problems({})).toEqual([]));
  it('rejects an empty body and a wrong step', () => {
    expect(problems({ body: '  ' })).not.toEqual([]);
    expect(problems({ stepNumber: 2 }).join()).toMatch(/adımı uyuşmuyor/);
  });
  it('rejects a new subject line', () => {
    expect(problems({ subject: 'Yeni konu' }).join()).toMatch(/konu satırı/);
    expect(withBody('Konu: Yeni bir teklif').join()).toMatch(/konu satırı/);
  });
  it('rejects more than 140 words', () => expect(withBody(Array.from({ length: 150 }, () => 'kelime').join(' ')).join()).toMatch(/çok uzun/));
  it('rejects pressure, guilt and fake urgency', () => {
    expect(withBody('Yoğun olduğunuzu biliyorum ama yazmak istedim.')).not.toEqual([]);
    expect(problems({ body: "Hi,\n\nJust bumping this to the top of your inbox.\n\nBest,\nBerk" })).not.toEqual([]);
    expect(problems({ body: "Hi,\n\nI haven't heard back from you three times now.\n\nBest,\nBerk" })).not.toEqual([]);
    expect(withBody('Bu son şans, acil dönüş bekliyorum.')).not.toEqual([]);
  });
  it('rejects claiming the prospect replied, and imitating a reply', () => {
    expect(withBody('Yanıtınız için teşekkürler, konuştuğumuz gibi ilerleyelim.').join()).toMatch(/yanıt vermiş gibi/);
    expect(problems({ body: 'Hi,\n\nThanks for your reply, as discussed here is more.\n\nBest' }).join()).toMatch(/yanıt vermiş gibi/);
    expect(withBody('> Önceki mesaj alıntısı').join()).toMatch(/alıntıyı taklit/);
  });
  it('rejects pushy meeting requests and hype', () => {
    expect(problems({ body: "Hi,\n\nLet's schedule a call this week, what time works?\n\nBest" })).not.toEqual([]);
    expect(withBody('Bu sistem işinizi bir üst seviyeye taşır.').join()).toMatch(/Abartılı/);
  });
  it('rejects company observations without evidence and unsupported problem claims', () => {
    expect(problems({ companyObservation: 'Websitenizde online randevu var.' }).join()).toMatch(/gözlem/);
    expect(withBody('Sitenize baktığımda randevu formunu gördüm.').join()).toMatch(/gördüm/);
    expect(withBody('Randevularınız dağınık ve manuel ilerliyor.').join()).toMatch(/sorun iddiası/);
  });
  it('rejects a sentence repeated from an earlier message', () => {
    const prevSentence = ctx.previousMessages[0].body.split('\n\n')[1];
    expect(withBody(prevSentence).join()).toMatch(/tekrarlanan/);
  });
  it('normalizes dash punctuation and drops unknown ids', () => {
    const v = validateFollowUpOutput({ ...good, body: good.body.replace('kısa bir not', 'kısa — bir not'), evidenceRefsUsed: ['nope'], sectorBenefitsUsed: ['nope'] }, ctx);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.output.body).not.toMatch(/—/);
      expect(v.output.evidenceRefsUsed).toEqual([]);
      expect(v.warnings.join()).toMatch(/Tire/);
    }
  });
  it('rejected output never reaches the caller', async () => {
    const bad = { id: 'fixture' as const, model: null, generate: async () => ({}), generateFollowUp: async () => ({ ...good, body: 'Yanıtınız için teşekkürler!' }) };
    await expect(generateFollowUpDraft(bad, ctx)).rejects.toBeInstanceOf(MailSafetyError);
  });
});

describe('same Gmail thread construction', () => {
  const thread = { threadId: 'th_123', inReplyTo: '<b@mail.gmail.com>', references: ['<a@mail.gmail.com>', '<b@mail.gmail.com>'] };
  const mail = { sendId: 'snd_1', to: { email: 'ece@kordon.example', name: 'Ece Aydın' }, subject: 'Kordon için CRM fikri', body: 'Merhaba', thread };

  it('adds In-Reply-To and References (parent last) and keeps the original subject', () => {
    const mime = buildMime(mail, 'berk@kite.example');
    expect(mime).toContain('In-Reply-To: <b@mail.gmail.com>');
    expect(mime).toContain('References: <a@mail.gmail.com> <b@mail.gmail.com>');
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('Kordon için CRM fikri').toString('base64')}?=`);
    expect(mime).not.toMatch(/Subject: .*Re:/);
  });

  it('never writes free text into threading headers', () => {
    expect(() => threadHeaders({ ...thread, inReplyTo: 'evil\r\nBcc: x@y.z' })).toThrow();
    expect(threadHeaders({ ...thread, references: ['not an id', '<a@mail.gmail.com>'] })[1]).toBe('References: <a@mail.gmail.com> <b@mail.gmail.com>');
  });

  it('a first contact has no threading headers', () => {
    const { thread: _t, ...first } = mail;
    expect(buildMime(first, null)).not.toMatch(/In-Reply-To|References/);
  });

  it('the Gmail API request names the existing threadId (fake fetch, no network)', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ id: 'm9', threadId: 'th_123' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const api = createGmailRestApi(fakeFetch);
    const r = await api.send('token', buildMime(mail, null), mail);
    expect(r).toEqual({ messageId: 'm9', threadId: 'th_123' });
    expect(requests[0].url).toMatch(/\/messages\/send$/);
    expect(requests[0].body.threadId).toBe('th_123');
    expect(Buffer.from(String(requests[0].body.raw), 'base64url').toString()).toContain('In-Reply-To: <b@mail.gmail.com>');
    const { thread: _t, ...first } = mail;
    await api.send('token', buildMime(first, null), first);
    expect(requests[1].body).not.toHaveProperty('threadId');
  });
});
