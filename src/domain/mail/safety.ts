// Shared output rules for generated mails, used by the first contact claim validation (claims.ts,
// Phase 13) and the follow up validation (followUpSafety.ts):
//   - No problem claims about the prospect ("your appointments are scattered") and first-hand
//     observation wording only with something KITE observed.
//   - No hype phrases, no spammy subjects. Dash punctuation is removed (soft rule, noted).

export const MAX_BODY_WORDS = 190;
export const MAX_SUBJECT_LENGTH = 80;

/** Unicode-aware whole-word matcher (JS \b does not understand ş, ü, ı …). */
export const words = (list: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

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

export const SPAM_SUBJECT = words(['free', 'ücretsiz', 'urgent', 'acil', 'last chance', 'son şans', 'guaranteed', 'garanti', 'act now', 'hemen', 'limited time', 'sınırlı süre', 'kaçırmayın', "don't miss"]);

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

export function sentences(text: string): string[] {
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

/** Problems of one subject line (length, spam words, pressure, shouting). */
export function subjectProblems(s: string): string[] {
  const out: string[] = [];
  if (s.length > MAX_SUBJECT_LENGTH) out.push(`Konu satırı çok uzun: "${s}"`);
  if (SPAM_SUBJECT.test(s) || /[!?]{2,}/.test(s) || shoutingWord(s)) out.push(`Konu satırı spam veya baskı içeriyor: "${s}"`);
  return out;
}
