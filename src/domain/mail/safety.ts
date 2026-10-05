// Output rules for generated first emails, enforced in code after every generation (fixture or
// model). A draft that breaks a hard rule is rejected, not silently shown to Berk.
//   - Structure: three subjects, a short body, ids that refer to what was actually provided.
//   - Provenance: a company observation needs company evidence; a "general" draft has none.
//   - No problem claims about the prospect ("your appointments are scattered") and no first-hand
//     observation wording when there is nothing KITE observed.
//   - No hype phrases, no spammy subjects. Dash punctuation is removed (soft rule, noted).
import type { MailContext } from './context';

export interface MailModelOutput {
  subjectOptions: string[];
  body: string;
  /** The one company-specific observation used, or null. */
  companyObservation: string | null;
  /** Why this service fits, in one or two sentences (Turkish, for Berk). */
  serviceReasoning: string;
  /** Sector use case ids woven into the body. */
  sectorBenefitsUsed: string[];
  /** Company evidence ids the body relies on. */
  evidenceRefsUsed: string[];
  /** Sector profile id used, or null when no sector guidance was used. */
  sectorProfileUsed: string | null;
}

export const MAX_BODY_WORDS = 190;
export const MAX_SUBJECT_LENGTH = 80;

/** Unicode-aware whole-word matcher (JS \b does not understand ş, ü, ı …). */
const words = (list: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

export const HYPE_PHRASES = words([
  'revolutioni[sz]e',
  'unlock your',
  'full potential',
  'next level',
  'game[ -]?changer',
  'skyrocket',
  'supercharge',
  'cutting[ -]edge',
  'world[ -]class',
  'best[ -]in[ -]class',
  'synergy',
  'devrim',
  'devrimsel',
  'potansiyelinizi',
  'bir üst seviyeye',
  'oyunun kurallarını',
  'çığır açan',
  'mükemmel çözüm',
  'rakipsiz',
]);

const SPAM_SUBJECT = words(['free', 'ücretsiz', 'urgent', 'acil', 'last chance', 'son şans', 'guaranteed', 'garanti', 'act now', 'hemen', 'limited time', 'sınırlı süre', 'kaçırmayın', "don't miss"]);

/** First-hand observation wording. Only allowed when the draft has company evidence. */
export const OBSERVATION_WORDING = words([
  'gördüm',
  'gördük',
  'fark ettim',
  'fark ettik',
  'inceledim',
  'inceledik',
  'dikkatimi çekti',
  'baktığımda',
  'baktığımızda',
  'i noticed',
  'we noticed',
  'i saw',
  'we saw',
  'i looked at your',
  'we looked at your',
  'i reviewed your',
  'we reviewed your',
  'looking at your',
]);

/** Words that describe a problem. Fine about a sector in general, not as a claim about "you". */
const PROBLEM_WORDS = words([
  'dağınık',
  'karmaşık',
  'düzensiz',
  'kaotik',
  'manuel',
  'elle',
  'excel',
  'kaybediyorsunuz',
  'kaçırıyorsunuz',
  'zorlanıyorsunuz',
  'zorlandığınızı',
  'yetersiz',
  'verimsiz',
  'scattered',
  'messy',
  'disorgani[sz]ed',
  'chaotic',
  'manual(?:ly)?',
  'spreadsheets?',
  'losing',
  'missing out',
  'struggl(?:e|ing)',
  'inefficient',
  'outdated',
]);

const SECOND_PERSON = /(?<![\p{L}])(?:you|your|you're|yours|siz|sizin|sizi|size|sizde)(?![\p{L}])|\p{L}+(?:nız|niz|nuz|nüz)(?:ın|in|un|ün|ı|i|u|ü|a|e|da|de|dan|den)?(?![\p{L}])/iu;

const DASH_PUNCTUATION = /\s+[-–—]+\s+|[–—]/g;

/** Replaces dash punctuation (spaced hyphens, en and em dashes) with commas. Hyphenated words stay. */
export function removeDashPunctuation(text: string): { text: string; changed: boolean } {
  const next = text.replace(DASH_PUNCTUATION, ', ').replace(/ ,/g, ',').replace(/,\s*,/g, ',');
  return { text: next, changed: next !== text };
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Sentences that state a problem about the prospect ("your appointments are scattered"). */
export function findProblemClaims(text: string): string[] {
  return sentences(text).filter((s) => PROBLEM_WORDS.test(s) && SECOND_PERSON.test(s));
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const ALLOWED_CAPS = new Set(['CRM', 'SEO', 'KITE', 'VIP', 'IVF', 'DMC', 'MICE', 'B2B', 'SAAS', 'HTTPS', 'AI', 'UK', 'USA', 'UAE', 'BT', 'IK']);

function shoutingWord(subject: string): boolean {
  return (subject.match(/\p{L}{4,}/gu) ?? []).some((w) => w === w.toLocaleUpperCase('tr-TR') && w !== w.toLocaleLowerCase('tr-TR') && !ALLOWED_CAPS.has(w));
}

export type MailValidation =
  | { ok: true; output: MailModelOutput; warnings: string[] }
  | { ok: false; problems: string[] };

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Validates and normalizes generator output against the context it was generated from. */
export function validateMailOutput(raw: unknown, ctx: MailContext): MailValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;

  if (!isStringArray(o.subjectOptions) || o.subjectOptions.filter((s) => s.trim()).length < 3) problems.push('Üç konu satırı alternatifi üretilmedi.');
  if (typeof o.body !== 'string' || !o.body.trim()) problems.push('Mail metni boş.');
  if (problems.length) return { ok: false, problems };

  let body = (o.body as string).trim();
  let subjects = (o.subjectOptions as string[]).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  let observation = typeof o.companyObservation === 'string' && o.companyObservation.trim() ? o.companyObservation.trim() : null;

  // Dash punctuation is removed rather than rejected.
  const cleanedBody = removeDashPunctuation(body);
  const cleanedSubjects = subjects.map(removeDashPunctuation);
  if (cleanedBody.changed || cleanedSubjects.some((s) => s.changed)) warnings.push('Tire noktalaması virgüle çevrildi.');
  body = cleanedBody.text;
  subjects = cleanedSubjects.map((s) => s.text.replace(/,\s*$/, ''));
  if (observation) observation = removeDashPunctuation(observation).text;

  // Ids must refer to what was provided; unknown ids are dropped (and noted).
  const evidenceIds = new Set(ctx.companyEvidence.items.map((e) => e.id));
  const evidenceRefsUsed = isStringArray(o.evidenceRefsUsed) ? o.evidenceRefsUsed : [];
  const knownEvidence = evidenceRefsUsed.filter((id) => evidenceIds.has(id));
  if (knownEvidence.length !== evidenceRefsUsed.length) warnings.push('Bilinmeyen kanıt referansları çıkarıldı.');

  const useCaseIds = new Set(ctx.sectorGuidance?.useCases.map((u) => u.id) ?? []);
  const benefits = isStringArray(o.sectorBenefitsUsed) ? o.sectorBenefitsUsed : [];
  const knownBenefits = benefits.filter((id) => useCaseIds.has(id));
  if (knownBenefits.length !== benefits.length) warnings.push('Bilinmeyen sektörel kullanım alanları çıkarıldı.');
  const profile = typeof o.sectorProfileUsed === 'string' ? o.sectorProfileUsed : null;
  const sectorProfileUsed = ctx.sectorGuidance && (profile === ctx.sectorGuidance.profileId || knownBenefits.length > 0) ? ctx.sectorGuidance.profileId : null;

  // Provenance.
  if (ctx.personalization === 'general') {
    if (observation) problems.push('Kanıt olmadan şirkete özel gözlem eklendi.');
    if (OBSERVATION_WORDING.test(body)) problems.push('Kanıt olmadan "gördüm / fark ettim" gibi şirkete özel gözlem ifadesi kullanıldı.');
  }
  if (observation && knownEvidence.length === 0) problems.push('Şirkete özel gözlem bir kanıta dayanmıyor.');
  if (!observation && OBSERVATION_WORDING.test(body) && knownEvidence.length === 0) {
    problems.push('Metinde kanıta dayanmayan bir gözlem ifadesi var.');
  }

  // Claims and tone.
  const claims = findProblemClaims(body);
  if (claims.length) problems.push(`Şirket hakkında kanıtlanmamış sorun iddiası: "${claims[0]}"`);
  if (HYPE_PHRASES.test(body) || subjects.some((s) => HYPE_PHRASES.test(s))) problems.push('Abartılı pazarlama ifadesi kullanıldı.');
  if (wordCount(body) > MAX_BODY_WORDS) problems.push(`Mail çok uzun (${wordCount(body)} kelime; en fazla ${MAX_BODY_WORDS}).`);

  if (subjects.length < 3) problems.push('Üç konu satırı alternatifi üretilmedi.');
  for (const s of subjects) {
    if (s.length > MAX_SUBJECT_LENGTH) problems.push(`Konu satırı çok uzun: "${s}"`);
    if (SPAM_SUBJECT.test(s) || /[!?]{2,}/.test(s) || shoutingWord(s)) problems.push(`Konu satırı spam veya baskı içeriyor: "${s}"`);
  }

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    warnings,
    output: {
      subjectOptions: subjects,
      body,
      companyObservation: observation,
      serviceReasoning: typeof o.serviceReasoning === 'string' ? o.serviceReasoning.trim() : '',
      sectorBenefitsUsed: knownBenefits,
      evidenceRefsUsed: knownEvidence,
      sectorProfileUsed,
    },
  };
}
