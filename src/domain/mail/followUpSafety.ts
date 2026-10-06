// Output rules for generated follow ups (Phase 7), enforced in code after every generation (fixture
// or model). Extends the first email rules (safety.ts): a follow up that breaks a hard rule is
// rejected and never reaches the editor.
//   - Structure: body only (no new subject), short (hard max 140 words), the requested step.
//   - Provenance: company observations only with company evidence (same rules as the first mail);
//     unknown evidence / sector ids are dropped and noted.
//   - Honesty about the conversation: never pretend the prospect replied, never quote or imitate a
//     reply, no guilt, no fake urgency, no pushy meeting requests.
//   - No repetition: no sentence of the earlier messages copied again.
import type { FollowUpContext } from './followUpContext';
import { findProblemClaims, HYPE_PHRASES, OBSERVATION_WORDING, removeDashPunctuation, wordCount } from './safety';

export interface FollowUpModelOutput {
  body: string;
  /** Short label of the angle used (e.g. "gentle_reminder", "no_show_reminders"). */
  followUpAngle: string;
  companyObservation: string | null;
  serviceReasoning: string;
  sectorBenefitsUsed: string[];
  evidenceRefsUsed: string[];
  /** Refs of the earlier messages the generator took into account ("original", "followup_1"). */
  previousMessagesConsidered: string[];
  stepNumber: number;
}

export const MAX_FOLLOW_UP_WORDS = 140;
export const TARGET_FOLLOW_UP_WORDS = { min: 40, max: 100 } as const;

const words = (list: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

/** Wording that pressures, guilts or nags (not approved for KITE follow ups). */
export const FOLLOW_UP_PRESSURE = words([
  "i know you(?:'| a)re busy",
  'yoğun olduğunuzu biliyorum',
  "haven't heard back",
  'have not heard back',
  'never heard back',
  "why haven't you",
  'why have you not',
  'neden (?:dönüş|yanıt|cevap)',
  'just bumping',
  'bumping this',
  'top of your inbox',
  'gelen kutunuzun en üst',
  'kaçırmış olabilirsiniz',
  'you may have missed',
  'last chance',
  'son şans',
  'son fırsat',
  'acil',
  'urgent',
  'hemen dönüş',
  'as soon as possible',
  'en kısa sürede dönüş',
  'üçüncü kez',
  'third time',
  'tekrar tekrar',
  'again and again',
]);

/** Pushy meeting or call requests. A low pressure offer to share an example is fine. */
export const FOLLOW_UP_MEETING_PUSH = words([
  'book a (?:call|meeting|demo)',
  'schedule a (?:call|meeting|demo)',
  "let's (?:hop on|jump on|schedule)",
  'toplantı ayarlayalım',
  'görüşme ayarlayalım',
  'hemen bir görüşme',
  'randevu alalım',
  'what time works',
  'hangi gün uygun',
]);

/** Claims that the prospect replied, agreed or spoke with KITE. They have not. */
export const CLAIMS_A_REPLY = words([
  'thanks? (?:you )?for your (?:reply|response|answer|interest)',
  'as you mentioned',
  'as you said',
  'as we discussed',
  'as discussed',
  'per our conversation',
  'following our call',
  'yanıtınız için',
  'cevabınız için',
  'dönüşünüz için',
  'ilginiz için teşekkür',
  'belirttiğiniz gibi',
  'dediğiniz gibi',
  'konuştuğumuz gibi',
  'görüştüğümüz gibi',
  'görüşmemizde',
]);

/** Lines that only appear in a reply or a forwarded message. */
const REPLY_IMITATION = /^\s*(?:>|re:|fw:|fwd:|ynt:|on .{3,80} wrote:|.{3,80} şunu yazdı:)/im;
/** A follow up continues the subject; it must not introduce one. */
const SUBJECT_LINE = /^\s*(?:subject|konu)\s*:/im;

export type FollowUpValidation =
  | { ok: true; output: FollowUpModelOutput; warnings: string[] }
  | { ok: false; problems: string[] };

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' '))
    .filter(Boolean);
}

/** Validates and normalizes follow up output against the context it was generated from. */
export function validateFollowUpOutput(raw: unknown, ctx: FollowUpContext): FollowUpValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  const base = ctx.base;

  if (typeof o.body !== 'string' || !o.body.trim()) return { ok: false, problems: ['Takip mail metni boş.'] };
  if (o.stepNumber !== ctx.stepNumber) problems.push(`Takip adımı uyuşmuyor (istenen ${ctx.stepNumber}. takip).`);
  if ('subject' in o || 'subjectOptions' in o) problems.push('Takip maili yeni bir konu satırı içeremez; mevcut konuşmanın konusu korunur.');

  let body = o.body.trim();
  const cleaned = removeDashPunctuation(body);
  if (cleaned.changed) warnings.push('Tire noktalaması virgüle çevrildi.');
  body = cleaned.text;
  let observation = typeof o.companyObservation === 'string' && o.companyObservation.trim() ? removeDashPunctuation(o.companyObservation.trim()).text : null;

  // Ids must refer to what was provided.
  const evidenceIds = new Set(base.companyEvidence.items.map((e) => e.id));
  const refs = isStringArray(o.evidenceRefsUsed) ? o.evidenceRefsUsed : [];
  const knownEvidence = refs.filter((id) => evidenceIds.has(id));
  if (knownEvidence.length !== refs.length) warnings.push('Bilinmeyen kanıt referansları çıkarıldı.');
  const useCaseIds = new Set(base.sectorGuidance?.useCases.map((u) => u.id) ?? []);
  const benefits = isStringArray(o.sectorBenefitsUsed) ? o.sectorBenefitsUsed : [];
  const knownBenefits = benefits.filter((id) => useCaseIds.has(id));
  if (knownBenefits.length !== benefits.length) warnings.push('Bilinmeyen sektörel kullanım alanları çıkarıldı.');
  const prevRefs = new Set(ctx.previousMessages.map((m) => m.ref));
  const considered = (isStringArray(o.previousMessagesConsidered) ? o.previousMessagesConsidered : []).filter((r) => prevRefs.has(r));
  if (ctx.previousMessages.length && considered.length === 0) problems.push('Önceki mailler dikkate alınmadı.');

  // Provenance (first email rules).
  if (base.personalization === 'general') {
    if (observation) problems.push('Kanıt olmadan şirkete özel gözlem eklendi.');
    if (OBSERVATION_WORDING.test(body)) problems.push('Kanıt olmadan "gördüm / fark ettim" gibi şirkete özel gözlem ifadesi kullanıldı.');
  }
  if (observation && knownEvidence.length === 0) problems.push('Şirkete özel gözlem bir kanıta dayanmıyor.');
  if (!observation && OBSERVATION_WORDING.test(body) && knownEvidence.length === 0) problems.push('Metinde kanıta dayanmayan bir gözlem ifadesi var.');
  const claims = findProblemClaims(body);
  if (claims.length) problems.push(`Şirket hakkında kanıtlanmamış sorun iddiası: "${claims[0]}"`);

  // Tone and honesty about the conversation.
  if (HYPE_PHRASES.test(body)) problems.push('Abartılı pazarlama ifadesi kullanıldı.');
  if (FOLLOW_UP_PRESSURE.test(body)) problems.push('Baskı, suçluluk veya sahte aciliyet içeren ifade kullanıldı.');
  if (FOLLOW_UP_MEETING_PUSH.test(body)) problems.push('Israrcı toplantı veya görüşme talebi var.');
  if (CLAIMS_A_REPLY.test(body)) problems.push('Alıcı yanıt vermemişken yanıt vermiş gibi yazılmış.');
  if (REPLY_IMITATION.test(body)) problems.push('Metin bir yanıtı veya alıntıyı taklit ediyor.');
  if (SUBJECT_LINE.test(body)) problems.push('Metinde yeni bir konu satırı var.');
  if (/[–—]|\s-+\s/.test(body)) problems.push('Tire noktalaması kaldı.');

  const n = wordCount(body);
  if (n > MAX_FOLLOW_UP_WORDS) problems.push(`Takip maili çok uzun (${n} kelime; en fazla ${MAX_FOLLOW_UP_WORDS}).`);
  else if (n > TARGET_FOLLOW_UP_WORDS.max) warnings.push(`Takip maili hedeften uzun (${n} kelime; hedef ${TARGET_FOLLOW_UP_WORDS.min} ile ${TARGET_FOLLOW_UP_WORDS.max}).`);

  // No sentence of an earlier message repeated (greetings and sign offs are short and exempt).
  const earlier = new Set(ctx.previousMessages.flatMap((m) => sentences(m.body)).filter((s) => wordCount(s) >= 6));
  const repeated = sentences(body).find((s) => earlier.has(s));
  if (repeated) problems.push(`Önceki bir mailden aynen tekrarlanan cümle: "${repeated}"`);

  if (problems.length) return { ok: false, problems };
  if (observation && ctx.previousMessages.filter((m) => m.companyObservation === observation).length >= 2) {
    warnings.push('Aynı şirket gözlemi daha önce iki kez kullanıldı.');
  }
  return {
    ok: true,
    warnings,
    output: {
      body,
      followUpAngle: typeof o.followUpAngle === 'string' && o.followUpAngle.trim() ? o.followUpAngle.trim().slice(0, 80) : ctx.purpose,
      companyObservation: observation,
      serviceReasoning: typeof o.serviceReasoning === 'string' ? o.serviceReasoning.trim() : '',
      sectorBenefitsUsed: knownBenefits,
      evidenceRefsUsed: knownEvidence,
      previousMessagesConsidered: considered,
      stepNumber: ctx.stepNumber,
    },
  };
}
