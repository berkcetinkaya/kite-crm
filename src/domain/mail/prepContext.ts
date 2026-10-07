// Generation context for prepared first contact drafts (Phase 13, prompt v2). Built by code from
// stored data and the readiness result: the model receives only these structured fields (never raw
// research JSON) and may only make statements backed by the closed list of claim sources.
import type { Company } from '../company';
import { CURRENT_USER } from '../company';
import { classifySector } from '../sectorTaxonomy';
import { sectorGuidanceFor } from '../sectorIntelligence';
import { formatLocation } from '../locations';
import type { ServiceKey } from '../services';
import {
  buildClaimSources,
  CTA_TEXT,
  GENERAL_INTRO,
  GENERAL_INTRO_LABEL,
  TONE_INSTRUCTIONS,
  TONE_LABELS,
  OUTREACH_TONES,
  type AvailableAngle,
  type ClaimSource,
  type CtaKey,
  type ManualFact,
  type OutreachTone,
} from '../outreachAngles';
import type { ClaimMapEntry, DraftSection, GenerateMode, SectionKey } from '../outreachPrep';
import type { RankedContact } from '../outreachReadiness';
import type { MailLanguage } from './draft';
import { serviceGuidance } from './serviceGuidance';

export const MAIL_PREP_PROMPT_VERSION = 'mail-v2';

export interface PrepAngle {
  key: string;
  label: string;
  theme: string;
}

export interface VariantRequest {
  id: string;
  label: string;
  tone: OutreachTone;
  angle: PrepAngle | null;
  /** Claim source ids this variant may cite. */
  sourceIds: string[];
}

export interface PrepContext {
  company: { name: string; website: string | null; location: string; sectorLabel: string };
  /** Greeting line composed by code (never a guessed name). */
  greeting: string;
  /** Named recipient (used for the greeting only), or null for the general address. */
  recipient: { name: string; role: string | null } | null;
  signOff: string;
  language: MailLanguage;
  tone: OutreachTone;
  service: ServiceKey;
  serviceName: string;
  servicePitch: string;
  /** Null for a general introduction. */
  angle: PrepAngle | null;
  general: boolean;
  cta: { key: CtaKey; text: string };
  sources: ClaimSource[];
  /** Ids the primary draft may cite. */
  sourceIds: string[];
  /** Sector use cases (general context only). */
  sectorUseCases: string[];
  mode: GenerateMode;
  /** Partial regeneration: the current generated sections, subjects and claims. */
  current: { sections: DraftSection[]; subjectOptions: string[]; claims: ClaimMapEntry[] } | null;
  variants: VariantRequest[];
  /** Exact validation problems of the previous attempt (repair retry only). */
  repairProblems: string[];
}

const toAngle = (a: AvailableAngle | null): PrepAngle | null => (a ? { key: a.key, label: a.label, theme: a.theme } : null);

export function greetingLine(recipient: RankedContact | null, companyName: string, lang: MailLanguage): string {
  const name = recipient && !recipient.general ? recipient.contact.fullName.trim() : '';
  if (name) return lang === 'tr' ? `Merhaba ${name},` : `Hi ${name},`;
  return lang === 'tr' ? `Merhaba ${companyName} ekibi,` : `Hello ${companyName} team,`;
}

export const signOffFor = (lang: MailLanguage) => `${lang === 'tr' ? 'İyi çalışmalar,' : 'Best regards,'}\n${CURRENT_USER}\nKITE Growth`;

/** Body = greeting, the non-empty sections in order, sign off. */
export function assembleBody(ctx: Pick<PrepContext, 'greeting' | 'signOff'>, sections: Record<SectionKey, string>): string {
  return [ctx.greeting, sections.opening, sections.observation, sections.value, sections.cta, ctx.signOff].map((s) => s.trim()).filter(Boolean).join('\n\n');
}

export function buildPrepContext(input: {
  company: Company;
  contact: RankedContact | null;
  service: ServiceKey;
  language: MailLanguage;
  tone: OutreachTone;
  angle: AvailableAngle | null;
  general: boolean;
  angles: AvailableAngle[];
  cta: CtaKey;
  manualFacts: readonly ManualFact[];
  mode: GenerateMode;
  current: PrepContext['current'];
  withVariants: boolean;
}): PrepContext {
  const { company, language: lang } = input;
  const sector = classifySector(company.sector, company.sectorId ?? null);
  const guidance = sectorGuidanceFor(input.service, company.sector, company.sectorId ?? null);
  const summary = guidance ? (lang === 'tr' ? guidance.summaryTr : guidance.summaryEn) : null;
  const angle = input.general ? null : input.angle;
  const primary = buildClaimSources({ company, language: lang, angle, manualFacts: input.manualFacts, sectorSummary: summary });

  // Variants: another evidence-backed angle (same tone) when one exists, and a different tone.
  const variants: VariantRequest[] = [];
  const sources = [...primary];
  if (input.withVariants && input.mode === 'full') {
    const otherTone = OUTREACH_TONES.find((t) => t !== input.tone)!;
    const alt = input.general ? null : input.angles.find((a) => a.key !== angle?.key) ?? null;
    if (alt) {
      // Alternative angle sources get their own ids (suffix "b") so the two sets never mix.
      const altSources = buildClaimSources({ company, language: lang, angle: alt, manualFacts: input.manualFacts, sectorSummary: summary })
        .filter((s) => s.kind === 'observed' || s.kind === 'search' || s.kind === 'inferred')
        .map((s) => ({ ...s, id: `${s.id}b` }));
      sources.push(...altSources);
      const shared = primary.filter((s) => s.kind === 'company' || s.kind === 'manual' || s.kind === 'sector').map((s) => s.id);
      variants.push({ id: 'v1', label: `Farklı açı: ${alt.label}`, tone: input.tone, angle: toAngle(alt), sourceIds: [...altSources.map((s) => s.id), ...shared] });
    }
    variants.push({ id: alt ? 'v2' : 'v1', label: `Farklı ton: ${TONE_LABELS[otherTone]}`, tone: otherTone, angle: toAngle(angle), sourceIds: primary.map((s) => s.id) });
  }

  const recipient = input.contact && !input.contact.general ? { name: input.contact.contact.fullName.trim(), role: input.contact.contact.role.trim() || null } : null;
  return {
    company: { name: company.name, website: company.website, location: formatLocation(company.city, company.country), sectorLabel: sector.label },
    greeting: greetingLine(input.contact, company.name, lang),
    recipient,
    signOff: signOffFor(lang),
    language: lang,
    tone: input.tone,
    service: input.service,
    serviceName: serviceGuidance(input.service).name[lang],
    servicePitch: serviceGuidance(input.service).pitch[lang],
    angle: toAngle(angle),
    general: input.general,
    cta: { key: input.cta, text: CTA_TEXT[input.cta][lang] },
    sources,
    sourceIds: primary.map((s) => s.id),
    sectorUseCases: (guidance?.useCases ?? []).slice(0, 4).map((u) => (lang === 'tr' ? u.tr : u.en)),
    mode: input.mode,
    current: input.current,
    variants,
    repairProblems: [],
  };
}

export const angleKeyOf = (ctx: Pick<PrepContext, 'angle' | 'general'>) => (ctx.general ? GENERAL_INTRO : ctx.angle?.key ?? null);
export const angleTitleOf = (ctx: Pick<PrepContext, 'angle' | 'general'>) => (ctx.general ? GENERAL_INTRO_LABEL : ctx.angle?.label ?? '');
export const toneInstruction = (t: OutreachTone) => TONE_INSTRUCTIONS[t];
