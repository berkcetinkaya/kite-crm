// Outreach angles, evidence and claim sources (Phase 13). Deterministic: code decides which angles
// exist for a company and service, which evidence supports them, how strong they are, which CTAs
// fit and which statements the generator may make (the claim sources). The model only phrases the
// chosen angle; it never invents one. Shared by the server (authority) and the browser (display).
//
// Evidence kinds (what a sentence may rest on):
//   observed  Gözlenen      measured by code on a page KITE inspected: may be stated directly
//   search    Arama kaynağı reported only by search sources: must be source-qualified
//   inferred  Çıkarım       model classification of inspected evidence: must be hedged
//   company   Şirket        public identity data (name, sector, location, website)
//   manual    Manuel        a fact the reviewer typed in Hazırlık
//   sector    Sektör        general sector guidance, never a fact about this company
// Unknown signals never become a claim source.
import type { Company } from './company';
import { isInspectedEvidence, type ConfidenceLevel, type ResearchEvidence, type ResearchResult } from './research';
import { researchConfidence } from './prospecting';
import { SERVICES, type ServiceKey } from './services';
import type { MailLanguage } from './mail/draft';
import { OBSERVATION_TEMPLATES, inferredSentence, inspectedSentence, searchSentence } from './mail/observations';
import { formatLocation } from './locations';

// ---------- Tones and CTAs ----------

export const OUTREACH_TONES = ['premium', 'direct', 'consultative', 'performance'] as const;
export type OutreachTone = (typeof OUTREACH_TONES)[number];
export const DEFAULT_TONE: OutreachTone = 'premium';
export const TONE_LABELS: Record<OutreachTone, string> = {
  premium: 'Premium & Sakin',
  direct: 'Kısa & Direkt',
  consultative: 'Danışmanlık Odaklı',
  performance: 'Performans Odaklı',
};
/** Prompt instruction per tone. Tone changes wording only, never facts. */
export const TONE_INSTRUCTIONS: Record<OutreachTone, string> = {
  premium: 'Calm, understated and premium. Short sentences, no exclamation marks, nothing salesy.',
  direct: 'Short and direct. Get to the point in the first two sentences; keep the whole email under 90 words.',
  consultative: 'Consultative: frame the idea as a possibility worth exploring together, curious rather than prescriptive.',
  performance: 'Performance minded: talk about enquiries, clarity and measurable steps, without quoting any numbers.',
};

export const CTA_KEYS = ['ideas_if_relevant', 'share_ideas', 'short_example', 'short_call', 'site_review'] as const;
export type CtaKey = (typeof CTA_KEYS)[number];
export const CTA_LABELS: Record<CtaKey, string> = {
  ideas_if_relevant: 'Uygunsa birkaç fikir paylaşayım',
  share_ideas: 'Birkaç somut fikir göndereyim',
  short_example: 'Basit bir örnek göstereyim',
  short_call: '15 dakikalık kısa bir görüşme',
  site_review: 'Kısa bir website değerlendirmesi paylaşayım',
};
export const CTA_TEXT: Record<CtaKey, Record<MailLanguage, string>> = {
  ideas_if_relevant: { tr: 'uygun görürseniz birkaç fikri kısaca paylaşabilirim', en: 'if it is useful, I can share a few ideas' },
  share_ideas: { tr: 'isterseniz birkaç somut fikri yazılı olarak gönderebilirim', en: 'I can send over a few concrete ideas in writing if you like' },
  short_example: { tr: 'isterseniz bunun sizde nasıl kurulabileceğine dair basit bir örnek gösterebilirim', en: 'I can show a simple example of how this could be set up for you' },
  short_call: { tr: 'uygunsa 15 dakikalık kısa bir görüşme yapabiliriz', en: 'if it is relevant, we could have a short 15 minute call' },
  site_review: { tr: 'isterseniz website tarafı için kısa bir değerlendirme paylaşabilirim', en: 'I can share a short website review if that helps' },
};

/** CTAs offered for a service and research confidence; the first is the default. Always low friction. */
export function ctaOptions(service: ServiceKey, confidence: ConfidenceLevel | null): CtaKey[] {
  const review: CtaKey[] = service === 'website' || service === 'seo' ? ['site_review'] : ['short_example'];
  if (confidence === 'high') return ['short_call', ...review, 'share_ideas', 'ideas_if_relevant'];
  if (confidence === 'medium') return ['share_ideas', ...review, 'ideas_if_relevant'];
  return ['ideas_if_relevant', 'share_ideas'];
}

// ---------- Angle catalogue ----------

export const GENERAL_INTRO = 'general_intro' as const;
export const GENERAL_INTRO_LABEL = 'Genel tanıtım';

export interface AngleDefinition {
  key: string;
  service: ServiceKey;
  label: string;
  /** For the prompt: what this angle is about (English). */
  theme: string;
  signals: readonly string[];
}

const A = (service: ServiceKey, key: string, label: string, theme: string, signals: string[]): AngleDefinition => ({ key, service, label, theme, signals });

export const ANGLE_CATALOGUE: readonly AngleDefinition[] = [
  A('crm', 'enquiry_handling', 'Talep ve rezervasyon akışı', 'keeping enquiries, bookings and messages from several channels in one simple flow', ['booking_flow', 'lead_or_quote_forms', 'whatsapp_contact', 'multiple_contact_channels']),
  A('crm', 'multi_branch', 'Çoklu lokasyon ve hizmet', 'coordinating several locations or a wide service range in one system', ['multiple_locations', 'service_breadth']),
  A('crm', 'consultative_sales', 'Görüşmeli satış süreci', 'following up consultations and quotes in a multi-step sales process', ['high_touch_sales', 'journey_complexity']),
  A('website', 'mobile_conversion', 'Mobil deneyim ve talep yolu', 'making it easy for mobile visitors to get in touch or book', ['missing_viewport', 'weak_cta', 'no_enquiry_path', 'contact_accessibility']),
  A('website', 'trust_clarity', 'Güven ve netlik', 'a clearer structure and stronger trust signals on the website', ['weak_trust_signals', 'weak_information_architecture', 'missing_h1']),
  A('website', 'technical_basics', 'Teknik temel', 'technical basics such as HTTPS, speed and page titles', ['not_https', 'slow_response', 'missing_meta_basics']),
  A('google_ads', 'commercial_search', 'Ticari arama talebi', 'reaching people who actively search for this kind of service', ['commercial_intent', 'high_ticket', 'service_landing_pages']),
  A('google_ads', 'local_demand', 'Yerel talep', 'local search demand and the existing enquiry points on the site', ['local_service', 'conversion_points']),
  A('meta_ads', 'visual_catalogue', 'Görsel ürün / hizmet vitrini', 'showing a visual offering to the right audience on Instagram and Facebook', ['visual_offering', 'ecommerce', 'category_breadth', 'aspirational_category']),
  A('meta_ads', 'campaign_offers', 'Kampanya ve yeniden hedefleme', 'campaignable offers and reaching past visitors again', ['campaignable_offers', 'remarketing_potential']),
  A('social_media', 'content_presence', 'Mevcut sosyal medya varlığı', 'building on the social profiles the company already has', ['social_presence_linked', 'social_profiles_found', 'posting_activity']),
  A('social_media', 'storytelling', 'Görsel hikâye anlatımı', 'telling the brand story with visual, community oriented content', ['visual_content_category', 'community_driven', 'storytelling_potential']),
  A('creative', 'visual_quality', 'Görsel kalite', 'visual quality for a business that sells visually or sits at the premium end', ['visual_sales_dependence', 'luxury_positioning', 'existing_creative_quality']),
  A('creative', 'ad_creative', 'Reklam kreatifleri', 'creative assets for ads across several offers or a catalogue', ['ad_suited_category', 'multiple_offers', 'ecommerce_catalogue']),
  A('seo', 'findability_basics', 'Bulunabilirlik temelleri', 'search basics such as page titles, headings and structured data', ['missing_meta_basics', 'heading_structure', 'structured_data_missing']),
  A('seo', 'local_search', 'Yerel arama', 'being found in local and service searches', ['local_intent', 'multi_location', 'search_driven_services']),
  A('seo', 'content_coverage', 'Hizmet sayfası kapsamı', 'covering each service with its own useful page', ['service_page_coverage', 'content_depth']),
];

export const anglesForService = (service: ServiceKey) => ANGLE_CATALOGUE.filter((a) => a.service === service);
export const angleDefinition = (key: string | null | undefined) => ANGLE_CATALOGUE.find((a) => a.key === key) ?? null;
export function angleLabel(key: string | null | undefined): string {
  if (key === GENERAL_INTRO) return GENERAL_INTRO_LABEL;
  return angleDefinition(key)?.label ?? '—';
}

// ---------- Evidence ----------

export type EvidenceKind = 'observed' | 'search' | 'inferred';
export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = { observed: 'Gözlenen', search: 'Arama kaynağı', inferred: 'Çıkarım' };
const KIND_POINTS: Record<EvidenceKind, number> = { observed: 2, search: 1, inferred: 1 };

/** One evidence-backed positive signal that may support an angle. */
export interface AngleEvidence {
  signalKey: string;
  label: string;
  kind: EvidenceKind;
  /** Turkish research note (for Berk). */
  reason: string;
  evidenceIds: string[];
  /** First supporting evidence URL, for "Bu cümle neye dayanıyor?". */
  url: string | null;
}

/**
 * Positive, evidence-backed signals of one service. Code-measured checks count as observed only
 * when the website was inspected (they rest on the inspected homepage); model classifications are
 * inferred when they rest on an inspected page and search-only otherwise. Unverified companies
 * never get "observed": their observations are downgraded to search wording.
 */
export function serviceEvidence(result: ResearchResult | null, service: ServiceKey): AngleEvidence[] {
  if (!result || result.source !== 'web') return [];
  const opp = result.serviceOpportunities?.find((o) => o.service === service);
  if (!opp) return [];
  const inspectedSite = !!result.analysis?.websiteInspected;
  const evidence = result.evidence ?? [];
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const inspected = (e: ResearchEvidence | undefined) => !!e && inspectedSite && isInspectedEvidence(e);
  const home = evidence.find((e) => inspected(e) && e.sourceType === 'official_website') ?? evidence.find((e) => inspected(e));
  const unverified = result.verification?.status === 'unverified';
  const out: AngleEvidence[] = [];
  for (const s of opp.signals) {
    if (s.state !== 'positive' || s.origin === 'not_inspected') continue;
    let kind: EvidenceKind;
    let ids: string[];
    if (s.origin === 'check') {
      if (!home) continue;
      ids = [home.id];
      kind = unverified ? 'search' : 'observed';
    } else {
      ids = s.evidenceIds.filter((id) => byId.has(id));
      if (!ids.length) continue;
      kind = ids.some((id) => inspected(byId.get(id))) ? 'inferred' : 'search';
    }
    if (out.some((x) => x.signalKey === s.key)) continue;
    out.push({ signalKey: s.key, label: s.label, kind, reason: s.reason, evidenceIds: ids, url: byId.get(ids[0])?.url ?? null });
  }
  return out;
}

export interface AvailableAngle {
  key: string;
  label: string;
  service: ServiceKey;
  theme: string;
  /** 2 per observed signal, 1 per search or inferred signal (top 3 only). */
  strength: number;
  /** Strongest first, at most 3. */
  evidence: AngleEvidence[];
}

const kindOrder = (k: EvidenceKind) => (k === 'observed' ? 0 : k === 'inferred' ? 1 : 2);

/** Angles of a service that have at least one evidence-backed signal, strongest first. */
export function availableAngles(result: ResearchResult | null, service: ServiceKey): AvailableAngle[] {
  const ev = serviceEvidence(result, service);
  return anglesForService(service)
    .map((def, order) => {
      const support = ev.filter((e) => def.signals.includes(e.signalKey)).sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind)).slice(0, 3);
      return { def, order, support, strength: support.reduce((n, e) => n + KIND_POINTS[e.kind], 0) };
    })
    .filter((a) => a.support.length > 0)
    .sort((a, b) => b.strength - a.strength || a.order - b.order)
    .map(({ def, support, strength }) => ({ key: def.key, label: def.label, service: def.service, theme: def.theme, strength, evidence: support }));
}

// ---------- Claim sources ----------

export type ClaimSourceKind = EvidenceKind | 'company' | 'manual' | 'sector';
export const CLAIM_SOURCE_LABELS: Record<ClaimSourceKind, string> = { ...EVIDENCE_KIND_LABELS, company: 'Şirket bilgisi', manual: 'Manuel', sector: 'Sektör bilgisi' };
const ID_PREFIX: Record<ClaimSourceKind, string> = { observed: 'O', search: 'S', inferred: 'I', company: 'C', manual: 'M', sector: 'G' };

export interface ClaimSource {
  id: string;
  kind: ClaimSourceKind;
  /** The statement in the mail language (observed / search use the fixed observation templates). */
  text: string;
  signalKey: string | null;
  evidenceIds: string[];
  url: string | null;
}

export interface ManualFact {
  id: string;
  text: string;
}

export const MAX_MANUAL_FACTS = 5;

function evidenceSentence(e: AngleEvidence, lang: MailLanguage): string {
  const t = OBSERVATION_TEMPLATES[e.signalKey];
  const label = e.label.toLocaleLowerCase(lang === 'tr' ? 'tr' : 'en');
  if (e.kind === 'observed') return t ? inspectedSentence(t, lang) : lang === 'tr' ? `Sitenize baktığımda ${label} ile ilgili bir nokta gördüm.` : `Looking at your website, I saw a point around ${label}.`;
  if (e.kind === 'search') return t ? searchSentence(t, lang) : lang === 'tr' ? `Hakkınızdaki kaynaklara göre ${label} tarafında bir fırsat olabilir.` : `Public sources suggest there may be an opportunity around ${label}.`;
  return t ? inferredSentence(t, lang) : lang === 'tr' ? `${e.label} tarafında bir fırsat olabilir.` : `There may be an opportunity around ${label}.`;
}

/**
 * The closed list of statements a draft may rest on. A general introduction gets company identity
 * and sector context only; an angle adds its (at most 3) supporting signals and the reviewer's
 * manual facts.
 */
export function buildClaimSources(input: {
  company: Pick<Company, 'name' | 'sector' | 'city' | 'country' | 'website'>;
  language: MailLanguage;
  angle: AvailableAngle | null;
  manualFacts: readonly ManualFact[];
  sectorSummary: string | null;
}): ClaimSource[] {
  const out: ClaimSource[] = [];
  const counters: Partial<Record<ClaimSourceKind, number>> = {};
  const push = (kind: ClaimSourceKind, text: string, extra: Partial<ClaimSource> = {}) => {
    counters[kind] = (counters[kind] ?? 0) + 1;
    out.push({ id: `${ID_PREFIX[kind]}${counters[kind]}`, kind, text, signalKey: null, evidenceIds: [], url: null, ...extra });
  };
  for (const e of input.angle?.evidence ?? []) push(e.kind, evidenceSentence(e, input.language), { signalKey: e.signalKey, evidenceIds: e.evidenceIds, url: e.url });
  const c = input.company;
  const where = formatLocation(c.city, c.country);
  push('company', input.language === 'tr' ? `${c.name}, ${where} merkezli bir ${c.sector} işletmesi${c.website ? ` (${c.website})` : ''}.` : `${c.name} is a ${c.sector} business based in ${where}${c.website ? ` (${c.website})` : ''}.`);
  if (input.angle) for (const f of input.manualFacts.slice(0, MAX_MANUAL_FACTS)) push('manual', f.text);
  if (input.sectorSummary) push('sector', input.sectorSummary);
  return out;
}

/** Research confidence of a company's linked research (null when there is none). */
export const linkedConfidence = (result: ResearchResult | null): ConfidenceLevel | null => (result && result.source === 'web' ? researchConfidence(result).level : null);

export const serviceLabel = (s: ServiceKey) => SERVICES[s].label;
