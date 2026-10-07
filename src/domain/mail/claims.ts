// Output validation for prepared drafts (Phase 13, prompt v2). Runs after every generation (fixture
// or model) and before anything is saved. Nothing is stripped or rewritten silently: a draft that
// breaks a rule is rejected with the exact reasons (the server may send them back once for repair).
//
// On top of the Phase 5 rules (hype, problem claims about the prospect, length, subjects):
//   - every company-specific sentence is in the claim map, and every claim cites known sources
//   - Çıkarım (inferred) claims are hedged; Arama kaynağı (search) claims are source-qualified;
//     first-hand wording ("gördüm", "I saw") only on Gözlenen (observed) claims
//   - a draft with an angle uses its evidence; a general introduction makes no company claims
//   - revenue, budgets, traffic, conversion rates, team size, customer counts, growth,
//     percentages and currency amounts only when backed by a manual fact
//   - no fake familiarity, referrals, audits or urgency; no fake "Re:" / "Fwd:" subjects
import type { ClaimSource } from '../outreachAngles';
import { makeSection, SECTION_KEYS, type ClaimMapEntry, type DraftSection, type SectionKey } from '../outreachPrep';
import { assembleBody, type PrepContext, type VariantRequest } from './prepContext';
import { findProblemClaims, HYPE_PHRASES, MAX_BODY_WORDS, OBSERVATION_WORDING, removeDashPunctuation, sentences, subjectProblems, wordCount, words } from './safety';

// ---------- Lexicons ----------

/** Hedges: "may / might / could …", "olabilir / görünüyor / -abilir …". */
export const HEDGE = new RegExp(
  [
    words(['olabilir', 'olabileceğini', 'olabileceğini düşündüm', 'görünüyor', 'gibi görünüyor', 'gibi duruyor', 'muhtemelen', 'belki', 'sanırım', 'düşünüyorum', 'düşündüm', 'olası', 'ihtimal', 'may', 'might', 'could', 'perhaps', 'possibly', 'likely', 'appears?', 'seems?', 'looks like', 'suggests?']).source,
    '\\p{L}+(?:abil|ebil)(?:ir|ecek|eceğini|eceğinizi|iriz)\\p{L}*',
  ].join('|'),
  'iu',
);

/** Source qualifiers for search-only evidence. */
export const SOURCE_QUALIFIER = words([
  'kaynak(?:lar)?(?:da|a|ın)?',
  'kaynaklara göre',
  'arama sonuçlar\\p{L}*',
  'hakkınızdaki',
  'paylaşılan bilgilere göre',
  'görebildiğim kadarıyla',
  'doğrulayamadım',
  'public sources',
  'sources',
  'search results',
  'listings',
  'according to',
  'online mentions',
  'could not confirm',
]);

/** Sentences that are about the company's own website or profiles. */
export const WEBSITE_REFERENCE = new RegExp(
  [
    '(?<![\\p{L}])(?:web ?)?siteniz\\p{L}*',
    '(?<![\\p{L}])ana sayfanız\\p{L}*',
    '(?<![\\p{L}])sayfalarınız\\p{L}*',
    '(?<![\\p{L}])hesaplarınız\\p{L}*',
    '(?<![\\p{L}])profilleriniz\\p{L}*',
    '\\byour (?:web ?site|site|homepage|home page|pages|instagram|social|profiles?)\\b',
  ].join('|'),
  'iu',
);

const FORBIDDEN_TOPIC = words([
  'ciro\\p{L}*',
  'geliriniz\\p{L}*',
  'gelirleriniz\\p{L}*',
  'yıllık gelir\\p{L}*',
  'kazancınız\\p{L}*',
  'reklam bütçe\\p{L}*',
  'reklam harcama\\p{L}*',
  'bütçe\\p{L}*',
  'trafi\\p{L}*',
  'ziyaretçi sayı\\p{L}*',
  'dönüşüm oran\\p{L}*',
  'çalışan sayı\\p{L}*',
  'ekip büyüklüğ\\p{L}*',
  'kişilik ekib\\p{L}*',
  'müşteri sayı\\p{L}*',
  'büyüme\\p{L}*',
  'büyüdü\\p{L}*',
  'büyüyor\\p{L}*',
  'revenue',
  'turnover',
  'ad spend',
  'budgets?',
  'traffic',
  'visitor numbers',
  'conversion rates?',
  'team size',
  'headcount',
  'employees',
  'number of customers',
  'customer count',
  'growth',
  'growing',
  'grew',
]);

const NUMERIC_CLAIM = /\d+(?:[.,]\d+)?\s*%|%\s*\d|(?<![\p{L}])yüzde\s+\d|\bper ?cent\b|[₺$€£]\s*\d|\d[\d.,]*\s*(?:TL|USD|EUR|GBP|dolar|euro|lira|pound)(?![\p{L}])|(?<![\p{L}])(?:milyon|milyar|million|billion)(?![\p{L}])/iu;

const FAKE_FAMILIARITY = words([
  'konuştuğumuz gibi',
  'görüştüğümüz gibi',
  'geçen hafta konuştuğumuz',
  'daha önce konuşmuştuk',
  'tanışmıştık',
  'hatırlarsanız',
  'tavsiyesiyle',
  'referansıyla',
  'sizi önerdi',
  'denetledik',
  'denetimimiz\\p{L}*',
  'raporunuzu hazırladık',
  'analiz raporu',
  'as we discussed',
  'as discussed',
  'per our conversation',
  'following up on our',
  'nice meeting you',
  'great to meet',
  'we spoke',
  'referred me',
  'recommended (?:that )?i reach out',
  'we audited',
  'our audit',
  'audit of your',
]);

const URGENCY = words(['acil', 'hemen', 'son şans', 'sınırlı süre', 'kaçırmayın', 'bugün karar', 'urgent', 'act now', 'last chance', 'limited time', "don't miss", 'right away']);
const FAKE_REPLY_SUBJECT = /^\s*(?:re|fwd?|fw|ynt|ilt|cvp)\s*:/i;

// ---------- Output shape ----------

export interface RawSections {
  opening: string;
  observation: string;
  value: string;
  cta: string;
}

export interface PrepDraftOutput {
  subjectOptions: string[];
  recommendedSubject: string;
  sections: DraftSection[];
  body: string;
  claims: ClaimMapEntry[];
}

export interface PrepVariantOutput extends PrepDraftOutput {
  id: string;
  label: string;
  angleKey: string | null;
  tone: VariantRequest['tone'];
}

export type PrepValidation =
  | { ok: true; draft: PrepDraftOutput; variants: PrepVariantOutput[]; serviceReasoning: string; warnings: string[] }
  | { ok: false; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : []);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');

function clean(s: string, changed: { v: boolean }): string {
  const r = removeDashPunctuation(s);
  if (r.changed) changed.v = true;
  return r.text;
}

function readSections(v: unknown, changed: { v: boolean }): RawSections | null {
  if (!isObj(v)) return null;
  return { opening: clean(str(v.opening), changed), observation: clean(str(v.observation), changed), value: clean(str(v.value), changed), cta: clean(str(v.cta), changed) };
}

function readClaims(v: unknown, changed: { v: boolean }): ClaimMapEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((c) => ({ sentence: clean(str(c.sentence), changed), sourceIds: strArr(c.sourceIds).slice(0, 8) })).filter((c) => c.sentence);
}

// ---------- Rules ----------

/** Checks one assembled draft (primary or variant) against the sources it may cite. */
export function checkDraft(d: { subjectOptions: string[]; body: string; sections: Record<SectionKey, string>; claims: ClaimMapEntry[] }, allowed: readonly ClaimSource[], opts: { general: boolean; label?: string }): string[] {
  const p: string[] = [];
  const at = (m: string) => (opts.label ? `${opts.label}: ${m}` : m);
  const byId = new Map(allowed.map((s) => [s.id, s]));
  const bodyNorm = norm(d.body);
  const signatureFree = d.body.replace(/KITE Growth/g, 'KITE');

  if (d.subjectOptions.length < 3) p.push(at('Üç konu satırı alternatifi üretilmedi.'));
  for (const s of d.subjectOptions) {
    p.push(...subjectProblems(s).map(at));
    if (FAKE_REPLY_SUBJECT.test(s)) p.push(at(`Konu satırı sahte yanıt / iletme gibi görünüyor: "${s}"`));
  }
  if (wordCount(d.body) > MAX_BODY_WORDS) p.push(at(`Mail çok uzun (${wordCount(d.body)} kelime; en fazla ${MAX_BODY_WORDS}).`));
  if (HYPE_PHRASES.test(d.body) || d.subjectOptions.some((s) => HYPE_PHRASES.test(s))) p.push(at('Abartılı pazarlama ifadesi kullanıldı.'));
  const problems = findProblemClaims(d.body);
  if (problems.length) p.push(at(`Şirket hakkında kanıtlanmamış sorun iddiası: "${problems[0]}"`));
  if (FAKE_FAMILIARITY.test(d.body)) p.push(at('Sahte tanışıklık, referans veya yapılmamış bir inceleme / denetim ifadesi var.'));
  if (URGENCY.test(d.body)) p.push(at('Aciliyet veya baskı ifadesi kullanıldı.'));

  // Claim map: known sources, present in the body, kind-specific wording.
  const manualBacked: string[] = [];
  let evidenceUsed = false;
  for (const c of d.claims) {
    const quote = `"${c.sentence}"`;
    if (!c.sourceIds.length) p.push(at(`Kaynak gösterilmeyen iddia: ${quote}`));
    const unknown = c.sourceIds.filter((id) => !byId.has(id));
    if (unknown.length) p.push(at(`Bilinmeyen kaynak (${unknown.join(', ')}): ${quote}`));
    if (!bodyNorm.includes(norm(c.sentence))) p.push(at(`İddia haritasındaki cümle metinde yok: ${quote}`));
    const kinds = new Set(c.sourceIds.map((id) => byId.get(id)?.kind).filter(Boolean));
    if (kinds.has('observed') || kinds.has('search') || kinds.has('inferred')) evidenceUsed = true;
    if (kinds.has('manual')) manualBacked.push(norm(c.sentence));
    if (kinds.has('inferred') && !HEDGE.test(c.sentence)) p.push(at(`Çıkarıma dayanan cümle temkinli ifade edilmeli (olabilir, görünüyor …): ${quote}`));
    if (kinds.has('search') && !SOURCE_QUALIFIER.test(c.sentence)) p.push(at(`Arama kaynağına dayanan cümle kaynağı belirtmeli ("kaynaklara göre …"): ${quote}`));
    if (OBSERVATION_WORDING.test(c.sentence) && !kinds.has('observed')) p.push(at(`"Gördüm / fark ettim" gibi ifade yalnızca gözlenen bir kanıtla kullanılabilir: ${quote}`));
  }

  // Coverage: company-specific sentences must be in the claim map.
  const claimNorms = d.claims.map((c) => norm(c.sentence));
  const covered = (s: string) => claimNorms.some((c) => c.includes(norm(s)) || norm(s).includes(c));
  for (const s of sentences(signatureFree)) {
    const specific = OBSERVATION_WORDING.test(s) || WEBSITE_REFERENCE.test(s) || SOURCE_QUALIFIER.test(s);
    if (!specific) continue;
    if (opts.general) p.push(at(`Genel tanıtımda şirkete özel gözlem olamaz: "${s}"`));
    else if (!covered(s)) p.push(at(`Şirkete özel cümle iddia haritasında yok: "${s}"`));
  }

  // Forbidden topics and numbers, unless the sentence rests on a manual fact.
  for (const s of [...sentences(signatureFree), ...d.subjectOptions]) {
    if (!(FORBIDDEN_TOPIC.test(s) || NUMERIC_CLAIM.test(s))) continue;
    if (manualBacked.some((m) => m.includes(norm(s)) || norm(s).includes(m))) continue;
    p.push(at(`Ciro, bütçe, trafik, oran, ekip, büyüme, yüzde veya tutar gibi bir bilgi manuel bir kayda dayanmadan kullanıldı: "${s}"`));
  }

  if (opts.general) {
    if (d.sections.observation.trim()) p.push(at('Genel tanıtımda gözlem bölümü boş kalmalı.'));
    if (evidenceUsed) p.push(at('Genel tanıtım şirket kanıtına dayanamaz.'));
  } else if (!evidenceUsed) p.push(at('Seçilen açının kanıtı metinde kullanılmadı (iddia haritasında gözlem / çıkarım kaynağı yok).'));
  return [...new Set(p)];
}

function similar(a: string, b: string): boolean {
  const wa = new Set(norm(a).split(/\s+/));
  const wb = new Set(norm(b).split(/\s+/));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.max(1, Math.min(wa.size, wb.size)) > 0.9;
}

const sectionsRecord = (list: readonly DraftSection[]): Record<SectionKey, string> =>
  Object.fromEntries(SECTION_KEYS.map((k) => [k, list.find((s) => s.key === k)?.text ?? ''])) as Record<SectionKey, string>;

/**
 * Validates raw model output for the context it was generated from. Partial modes take only the
 * requested part from the output and keep everything else from ctx.current.
 */
export function validatePrepOutput(raw: unknown, ctx: PrepContext): PrepValidation {
  const o = isObj(raw) ? raw : {};
  const changed = { v: false };
  const shape: string[] = [];
  const subjects = strArr(o.subjectOptions).slice(0, 3).map((s) => clean(s, changed).replace(/,\s*$/, ''));
  const sections = readSections(o.sections, changed);
  if (ctx.mode === 'full' || ctx.mode === 'subject') if (subjects.length < 3) shape.push('Üç konu satırı alternatifi üretilmedi.');
  if (ctx.mode !== 'subject' && !sections) shape.push('Mail bölümleri (giriş, gözlem, değer, kapanış) üretilmedi.');
  if (ctx.mode !== 'full' && !ctx.current) shape.push('Kısmi yeniden yazım için mevcut taslak bulunamadı.');
  if (shape.length) return { ok: false, problems: shape };

  const newClaims = readClaims(o.claims, changed);
  let finalSections: Record<SectionKey, string>;
  let finalSubjects: string[];
  let claims: ClaimMapEntry[];
  if (ctx.mode === 'full') {
    if (!sections!.opening || !sections!.value || !sections!.cta) shape.push('Giriş, değer ve kapanış bölümleri boş olamaz.');
    finalSections = sections!;
    finalSubjects = subjects;
    claims = newClaims;
  } else {
    const cur = sectionsRecord(ctx.current!.sections);
    finalSubjects = ctx.mode === 'subject' ? subjects : ctx.current!.subjectOptions;
    finalSections = { ...cur };
    if (ctx.mode === 'opening' || ctx.mode === 'cta') {
      const text = sections![ctx.mode];
      if (!text) shape.push(`${ctx.mode === 'opening' ? 'Giriş' : 'Kapanış'} bölümü üretilmedi.`);
      finalSections[ctx.mode] = text;
    }
    const body = assembleBody(ctx, finalSections);
    const kept = ctx.current!.claims.filter((c) => norm(body).includes(norm(c.sentence)));
    const added = ctx.mode === 'subject' ? [] : newClaims.filter((c) => norm(finalSections[ctx.mode as SectionKey]).includes(norm(c.sentence)));
    claims = [...kept, ...added];
  }
  if (shape.length) return { ok: false, problems: shape };

  const body = assembleBody(ctx, finalSections);
  const allowed = ctx.sources.filter((s) => ctx.sourceIds.includes(s.id));
  const problems = checkDraft({ subjectOptions: finalSubjects, body, sections: finalSections, claims }, allowed, { general: ctx.general });

  const variants: PrepVariantOutput[] = [];
  if (ctx.mode === 'full' && ctx.variants.length) {
    const rawVariants = Array.isArray(o.variants) ? o.variants.filter(isObj) : [];
    for (const req of ctx.variants) {
      const rv = rawVariants.find((v) => str(v.id) === req.id);
      if (!rv) {
        problems.push(`${req.label}: alternatif üretilmedi.`);
        continue;
      }
      const vs = readSections(rv.sections, changed);
      const vSubjects = strArr(rv.subjectOptions).slice(0, 3).map((s) => clean(s, changed).replace(/,\s*$/, ''));
      if (!vs) {
        problems.push(`${req.label}: bölümler üretilmedi.`);
        continue;
      }
      const vBody = assembleBody(ctx, vs);
      const vClaims = readClaims(rv.claims, changed);
      problems.push(...checkDraft({ subjectOptions: vSubjects, body: vBody, sections: vs, claims: vClaims }, ctx.sources.filter((s) => req.sourceIds.includes(s.id)), { general: ctx.general, label: req.label }));
      if (similar(vBody, body)) problems.push(`${req.label}: ana taslağa çok benziyor.`);
      variants.push({
        id: req.id,
        label: req.label,
        angleKey: ctx.general ? 'general_intro' : req.angle?.key ?? null,
        tone: req.tone,
        subjectOptions: vSubjects,
        recommendedSubject: vSubjects.includes(str(rv.recommendedSubject)) ? str(rv.recommendedSubject) : vSubjects[0] ?? '',
        sections: SECTION_KEYS.map((k) => makeSection(k, vs[k])),
        body: vBody,
        claims: vClaims,
      });
    }
  }
  if (problems.length) return { ok: false, problems: [...new Set(problems)] };

  const warnings: string[] = [];
  if (changed.v) warnings.push('Tire noktalaması virgüle çevrildi.');
  const rec = str(o.recommendedSubject);
  const recommendedSubject = ctx.mode === 'subject' || ctx.mode === 'full' ? (finalSubjects.includes(rec) ? rec : finalSubjects[0]) : finalSubjects[0];
  return {
    ok: true,
    warnings,
    serviceReasoning: str(o.serviceReasoning),
    draft: { subjectOptions: finalSubjects, recommendedSubject, sections: SECTION_KEYS.map((k) => makeSection(k, finalSections[k])), body, claims },
    variants,
  };
}
