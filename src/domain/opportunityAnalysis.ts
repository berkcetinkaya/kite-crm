// Central, editable definitions for evidence-based opportunity analysis, plus the deterministic
// scoring layer. The model only classifies signals (positive/neutral/negative/unknown) with evidence;
// every number shown to Berk is computed here from those classifications.
import type {
  CompanyAnalysis,
  CompanyVerification,
  ConfidenceLevel,
  CriteriaMatch,
  Recommendation,
  ServiceOpportunityAnalysis,
  ServiceSignal,
  SignalState,
  VerificationStatus,
  WebsiteTechnicalSummary,
} from './research';
import { SCORE_BANDS } from './score';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from './services';

type CheckResult = { state: SignalState; reason: string };

export interface SignalDefinition {
  key: string;
  /** Turkish label shown in the UI. */
  label: string;
  /** Relative importance within its service. */
  weight: number;
  /**
   * How the model should classify this signal (English, for the prompt). "positive" always means
   * "supports a KITE opportunity", never "the company is good at this".
   */
  guide?: string;
  /** Deterministic check from website measurements. Takes precedence over the model. */
  check?: (t: WebsiteTechnicalSummary) => CheckResult;
  /** Things Phase 4 cannot observe (e.g. posting frequency). Always unknown, with this reason. */
  notInspected?: string;
}

const NOT_INSPECTED: CheckResult = { state: 'unknown', reason: 'Website incelenemedi.' };

/** Wraps a check so it returns unknown when the site was not inspected or the value is missing. */
function measured(fn: (t: WebsiteTechnicalSummary) => CheckResult | null): (t: WebsiteTechnicalSummary) => CheckResult {
  return (t) => (t.inspected ? fn(t) ?? { state: 'unknown', reason: 'Ölçülemedi.' } : NOT_INSPECTED);
}

const contactChannels = (t: WebsiteTechnicalSummary) =>
  [t.hasEmail, t.hasPhone, t.hasWhatsApp, t.hasContactPage].filter(Boolean).length;

const metaBasicsCheck = measured((t) => {
  if (t.hasTitle === null || t.hasMetaDescription === null) return null;
  const missing = [!t.hasTitle && 'başlık (title)', !t.hasMetaDescription && 'meta açıklama'].filter(Boolean);
  return missing.length
    ? { state: 'positive', reason: `Ana sayfada eksik: ${missing.join(', ')}.` }
    : { state: 'negative', reason: 'Ana sayfada başlık ve meta açıklama mevcut.' };
});

const ecommerceCheck = measured((t) =>
  t.hasEcommerceSignal === null
    ? null
    : t.hasEcommerceSignal
      ? { state: 'positive', reason: 'Sitede e-ticaret / sepet sinyali tespit edildi.' }
      : { state: 'neutral', reason: 'E-ticaret sinyali tespit edilmedi.' },
);

export const SERVICE_SIGNALS: Record<ServiceKey, SignalDefinition[]> = {
  crm: [
    {
      key: 'booking_flow',
      label: 'Randevu / rezervasyon akışı',
      weight: 3,
      guide: 'positive if the business takes appointments, reservations or bookings (online or by enquiry); negative if it clearly does not.',
    },
    {
      key: 'lead_or_quote_forms',
      label: 'Teklif / talep formları',
      weight: 3,
      guide: 'positive if there are enquiry, quote-request or lead forms; neutral if only a generic contact form; negative if no way to enquire.',
    },
    {
      key: 'multiple_locations',
      label: 'Birden fazla şube / lokasyon',
      weight: 2,
      guide: 'positive if the company lists several branches/locations/teams; negative if clearly a single location.',
    },
    {
      key: 'service_breadth',
      label: 'Geniş hizmet / ürün kataloğu',
      weight: 2,
      guide: 'positive if many distinct services, treatments, tours, properties or product lines are offered.',
    },
    {
      key: 'whatsapp_contact',
      label: 'WhatsApp iletişimi',
      weight: 1,
      check: measured((t) =>
        t.hasWhatsApp === null
          ? null
          : t.hasWhatsApp
            ? { state: 'positive', reason: 'Websitede WhatsApp iletişim bağlantısı bulunuyor.' }
            : { state: 'neutral', reason: 'Websitede WhatsApp bağlantısı tespit edilmedi.' },
      ),
    },
    {
      key: 'multiple_contact_channels',
      label: 'Birden fazla iletişim kanalı',
      weight: 1,
      check: measured((t) => {
        const n = contactChannels(t);
        return n >= 3
          ? { state: 'positive', reason: `${n} ayrı iletişim kanalı tespit edildi.` }
          : { state: 'neutral', reason: `${n} iletişim kanalı tespit edildi.` };
      }),
    },
    {
      key: 'high_touch_sales',
      label: 'B2B / yüksek temaslı satış süreci',
      weight: 2,
      guide: 'positive if sales involve consultations, quotes, proposals, B2B enquiries, dealer networks or high-ticket decisions.',
    },
    {
      key: 'journey_complexity',
      label: 'Çok adımlı müşteri yolculuğu',
      weight: 2,
      guide: 'positive if customers go through several steps (enquiry → consultation → booking → follow-up, transfers, property viewings, tours).',
    },
    {
      key: 'existing_customer_portal',
      label: 'Mevcut müşteri portalı / sistem',
      weight: 1,
      guide: 'negative if the site shows a customer login/portal or a booking platform suggesting an existing system is in place; positive if clearly absent; unknown otherwise.',
    },
  ],
  website: [
    {
      key: 'missing_viewport',
      label: 'Mobil viewport etiketi',
      weight: 3,
      check: measured((t) =>
        t.hasViewport === null
          ? null
          : t.hasViewport
            ? { state: 'negative', reason: 'Mobil viewport etiketi mevcut.' }
            : { state: 'positive', reason: 'Mobil viewport etiketi bulunamadı.' },
      ),
    },
    {
      key: 'weak_cta',
      label: 'Dönüşüm odaklı CTA yapısı',
      weight: 3,
      check: measured((t) =>
        t.ctaCount === null
          ? null
          : t.ctaCount === 0
            ? { state: 'positive', reason: 'Ana sayfada belirgin bir CTA (randevu, teklif, iletişim) tespit edilemedi.' }
            : t.ctaCount <= 2
              ? { state: 'neutral', reason: `Ana sayfada sınırlı sayıda CTA tespit edildi (${t.ctaCount}).` }
              : { state: 'negative', reason: `Ana sayfada ${t.ctaCount} CTA tespit edildi.` },
      ),
    },
    {
      key: 'no_enquiry_path',
      label: 'Talep / rezervasyon yolu',
      weight: 3,
      check: measured((t) =>
        t.formCount === null
          ? null
          : t.formCount === 0 && !t.hasBookingSignal && !t.hasWhatsApp
            ? { state: 'positive', reason: 'İncelenen sayfalarda form, rezervasyon veya WhatsApp yolu bulunamadı.' }
            : { state: 'negative', reason: 'Sitede en az bir talep / rezervasyon yolu bulunuyor.' },
      ),
    },
    { key: 'missing_meta_basics', label: 'Başlık ve meta açıklama', weight: 1, check: metaBasicsCheck },
    {
      key: 'missing_h1',
      label: 'Ana başlık (H1)',
      weight: 1,
      check: measured((t) =>
        t.h1Count === null
          ? null
          : t.h1Count === 0
            ? { state: 'positive', reason: 'Ana sayfada H1 başlığı bulunamadı.' }
            : { state: 'negative', reason: 'Ana sayfada H1 başlığı mevcut.' },
      ),
    },
    {
      key: 'not_https',
      label: 'HTTPS',
      weight: 2,
      check: measured((t) =>
        t.https === null
          ? null
          : t.https
            ? { state: 'negative', reason: 'Site HTTPS üzerinden sunuluyor.' }
            : { state: 'positive', reason: 'Site HTTPS kullanmıyor.' },
      ),
    },
    {
      key: 'slow_response',
      label: 'Sunucu yanıt süresi',
      weight: 1,
      check: measured((t) =>
        t.responseTimeMs === null
          ? null
          : t.responseTimeMs > 3000
            ? { state: 'positive', reason: `Ana sayfa yanıtı yavaş (${t.responseTimeMs} ms, tek ölçüm).` }
            : t.responseTimeMs < 1200
              ? { state: 'negative', reason: `Ana sayfa hızlı yanıt verdi (${t.responseTimeMs} ms, tek ölçüm).` }
              : { state: 'neutral', reason: `Ana sayfa yanıt süresi ${t.responseTimeMs} ms (tek ölçüm).` },
      ),
    },
    {
      key: 'weak_information_architecture',
      label: 'Bilgi mimarisi / hizmet sunumu',
      weight: 2,
      guide: 'positive if navigation and page structure make services hard to find or poorly organised (judge from navigation labels, headings and page structure only, never visual design); negative if clearly structured.',
    },
    {
      key: 'weak_trust_signals',
      label: 'Güven unsurları',
      weight: 2,
      guide: 'positive if trust elements (reviews, testimonials, certifications, team, awards, case studies) are absent from inspected pages; negative if present.',
    },
    {
      key: 'contact_accessibility',
      label: 'İletişim erişilebilirliği',
      weight: 1,
      check: measured((t) =>
        contactChannels(t) === 0
          ? { state: 'positive', reason: 'İncelenen sayfalarda e-posta, telefon veya iletişim sayfası bulunamadı.' }
          : { state: 'negative', reason: 'İletişim bilgileri sitede erişilebilir.' },
      ),
    },
  ],
  google_ads: [
    {
      key: 'commercial_intent',
      label: 'Ticari arama niyeti',
      weight: 3,
      guide: 'positive if people typically search for and buy these services/products with clear commercial intent.',
    },
    {
      key: 'local_service',
      label: 'Yerel arama niyeti',
      weight: 2,
      guide: 'positive if the business serves a specific city/area where local searches ("near me", city + service) matter.',
    },
    {
      key: 'high_ticket',
      label: 'Yüksek bilet değeri',
      weight: 3,
      guide: 'positive if typical purchases are high-value (medical/aesthetic procedures, real estate, luxury travel, B2B contracts).',
    },
    {
      key: 'conversion_points',
      label: 'Dönüşüm noktaları (form, rezervasyon, telefon)',
      weight: 2,
      check: measured((t) =>
        (t.formCount ?? 0) > 0 || t.hasBookingSignal || t.hasPhone
          ? { state: 'positive', reason: 'Sitede reklam trafiğini karşılayabilecek dönüşüm noktaları var.' }
          : { state: 'negative', reason: 'Sitede belirgin dönüşüm noktası tespit edilemedi.' },
      ),
    },
    {
      key: 'service_landing_pages',
      label: 'Hizmet sayfaları',
      weight: 2,
      guide: 'positive if distinct service/product pages exist that ads could point to.',
    },
    {
      key: 'category_breadth',
      label: 'Birden fazla ticari kategori',
      weight: 1,
      guide: 'positive if there are several separately searchable commercial categories.',
    },
  ],
  meta_ads: [
    {
      key: 'visual_offering',
      label: 'Görsel ürün / hizmet',
      weight: 3,
      guide: 'positive if the offering is inherently visual (fashion, hospitality, interiors, aesthetics, food, real estate).',
    },
    {
      key: 'aspirational_category',
      label: 'Özendirici / lifestyle kategori',
      weight: 2,
      guide: 'positive for luxury, lifestyle or aspirational categories.',
    },
    { key: 'ecommerce', label: 'E-ticaret', weight: 2, check: ecommerceCheck },
    {
      key: 'campaignable_offers',
      label: 'Kampanyaya uygun teklifler',
      weight: 2,
      guide: 'positive if the site shows packages, seasonal offers, promotions or bundles.',
    },
    {
      key: 'remarketing_potential',
      label: 'Remarketing potansiyeli',
      weight: 2,
      guide: 'positive if purchases are considered over time (repeat visits, comparison before booking/buying).',
    },
    {
      key: 'social_presence_linked',
      label: 'Bağlı sosyal medya hesapları',
      weight: 1,
      check: measured((t) =>
        t.socialLinks.some((s) => /instagram|facebook/.test(s))
          ? { state: 'positive', reason: 'Sitede Instagram/Facebook hesabı bağlantısı var.' }
          : { state: 'neutral', reason: 'Sitede Instagram/Facebook bağlantısı tespit edilmedi.' },
      ),
    },
  ],
  social_media: [
    {
      key: 'social_profiles_found',
      label: 'Resmi sosyal medya hesapları',
      weight: 2,
      check: measured((t) =>
        t.socialLinks.length > 0
          ? { state: 'positive', reason: `Sitede ${t.socialLinks.length} sosyal medya bağlantısı bulundu.` }
          : { state: 'unknown', reason: 'Sitede sosyal medya bağlantısı bulunamadı; hesap durumu bilinmiyor.' },
      ),
    },
    {
      key: 'visual_content_category',
      label: 'Görsel içeriğe uygun kategori',
      weight: 3,
      guide: 'positive if the category lends itself to regular visual content (before/after, rooms, products, destinations, food).',
    },
    {
      key: 'posting_activity',
      label: 'Paylaşım sıklığı',
      weight: 2,
      notInspected: 'Sosyal medya hesapları bu fazda incelenmiyor; paylaşım sıklığı bilinmiyor.',
    },
    {
      key: 'community_driven',
      label: 'Topluluk / müşteri etkileşimi',
      weight: 2,
      guide: 'positive if customers choose based on reviews, community and social proof (hospitality, beauty, clinics, consumer brands).',
    },
    {
      key: 'storytelling_potential',
      label: 'Marka hikâyesi potansiyeli',
      weight: 1,
      guide: 'positive if there is a founder, craft, heritage or process story worth telling.',
    },
  ],
  creative: [
    {
      key: 'ad_suited_category',
      label: 'Düzenli reklam kreatifine uygun kategori',
      weight: 3,
      guide: 'positive if the category needs a steady flow of ad creatives (ecommerce, hospitality, aesthetics, real estate, events).',
    },
    {
      key: 'multiple_offers',
      label: 'Birden fazla teklif / kampanya',
      weight: 2,
      guide: 'positive if there are many offers, packages, collections or seasonal campaigns to promote.',
    },
    {
      key: 'visual_sales_dependence',
      label: 'Satışın görsele bağlılığı',
      weight: 3,
      guide: 'positive if buying decisions depend heavily on visuals.',
    },
    { key: 'ecommerce_catalogue', label: 'E-ticaret kataloğu', weight: 2, check: ecommerceCheck },
    {
      key: 'luxury_positioning',
      label: 'Premium / lüks konumlanma',
      weight: 2,
      guide: 'positive if the business positions itself as premium or luxury based on its own wording, pricing or offering (not on visual design).',
    },
    {
      key: 'existing_creative_quality',
      label: 'Mevcut reklam kreatifleri',
      weight: 2,
      notInspected: 'Mevcut reklam kreatifleri görsel olarak incelenmedi.',
    },
  ],
  seo: [
    {
      key: 'search_driven_services',
      label: 'Arama odaklı hizmetler',
      weight: 3,
      guide: 'positive if customers research these services via search engines before buying.',
    },
    {
      key: 'local_intent',
      label: 'Yerel SEO potansiyeli',
      weight: 2,
      guide: 'positive if city/area-based searches matter for this business.',
    },
    { key: 'missing_meta_basics', label: 'Başlık ve meta açıklama', weight: 2, check: metaBasicsCheck },
    {
      key: 'heading_structure',
      label: 'Başlık yapısı',
      weight: 1,
      check: measured((t) =>
        t.h1Count === null
          ? null
          : t.h1Count === 0
            ? { state: 'positive', reason: 'Ana sayfada H1 yok.' }
            : t.h1Count > 1
              ? { state: 'neutral', reason: `Ana sayfada ${t.h1Count} adet H1 var.` }
              : { state: 'negative', reason: 'Ana sayfada tek bir H1 var.' },
      ),
    },
    {
      key: 'service_page_coverage',
      label: 'Hizmet / lokasyon sayfaları',
      weight: 2,
      guide: 'positive if the site lacks dedicated pages for its individual services or locations; negative if it already has them.',
    },
    {
      key: 'multi_location',
      label: 'Çok lokasyonlu yapı',
      weight: 2,
      guide: 'positive if the company serves several cities/areas that could each have landing pages.',
    },
    {
      key: 'content_depth',
      label: 'İçerik derinliği',
      weight: 2,
      guide: 'positive if there is little informational content (blog, guides, FAQs) for a search-driven category; negative if substantial.',
    },
    {
      key: 'structured_data_missing',
      label: 'Yapılandırılmış veri (schema.org)',
      weight: 1,
      check: measured((t) =>
        t.hasStructuredData === null
          ? null
          : t.hasStructuredData
            ? { state: 'negative', reason: 'Sayfada yapılandırılmış veri (JSON-LD) mevcut.' }
            : { state: 'positive', reason: 'Sayfada yapılandırılmış veri bulunamadı.' },
      ),
    },
  ],
};

/** Signals the model is asked to classify (no deterministic check, observable in Phase 4). */
export function modelClassifiedSignals(service: ServiceKey): SignalDefinition[] {
  return SERVICE_SIGNALS[service].filter((s) => !s.check && !s.notInspected);
}

// ---------- Scoring ----------

/**
 * Score rule (per service):
 *   value(positive)=1, value(neutral)=0.5, value(negative)=0; unknown signals are left out.
 *   score = round(100 × (Σ known weight×value + PRIOR_WEIGHT×0.5) / (Σ known weight + PRIOR_WEIGHT))
 * The prior pulls scores toward 50 when little is known, so a single positive signal cannot
 * produce a high score. Unknowns lower confidence rather than the score.
 */
export const PRIOR_WEIGHT = 4;

const STATE_VALUE: Record<Exclude<SignalState, 'unknown'>, number> = { positive: 1, neutral: 0.5, negative: 0 };

/**
 * Confidence rule: coverage = Σ known weight / Σ all weights for the service.
 *   ≥ 0.75 → high, ≥ 0.45 → medium, otherwise low. Capped at low when the website was not inspected.
 */
export function confidenceFromCoverage(coverage: number, websiteInspected: boolean): ConfidenceLevel {
  const level: ConfidenceLevel = coverage >= 0.75 ? 'high' : coverage >= 0.45 ? 'medium' : 'low';
  return websiteInspected ? level : 'low';
}

export function scoreSignals(signals: readonly Pick<ServiceSignal, 'state' | 'weight'>[]): { score: number; coverage: number } {
  let knownWeight = 0;
  let value = 0;
  let totalWeight = 0;
  for (const s of signals) {
    totalWeight += s.weight;
    if (s.state === 'unknown') continue;
    knownWeight += s.weight;
    value += s.weight * STATE_VALUE[s.state];
  }
  const score = Math.round((100 * (value + PRIOR_WEIGHT * 0.5)) / (knownWeight + PRIOR_WEIGHT));
  return { score, coverage: totalWeight ? knownWeight / totalWeight : 0 };
}

/** A model (or fixture) classification for one signal. */
export interface SignalClassification {
  state: SignalState;
  reason: string;
  evidenceIds: string[];
}

/**
 * Builds every service's signals: deterministic checks first, "not inspected" signals as unknown,
 * the rest from model classifications (missing ones become unknown).
 */
export function buildServiceSignals(
  service: ServiceKey,
  technical: WebsiteTechnicalSummary,
  classified: Partial<Record<string, SignalClassification>>,
): ServiceSignal[] {
  return SERVICE_SIGNALS[service].map((def) => {
    const base = { key: def.key, label: def.label, weight: def.weight };
    if (def.notInspected) return { ...base, state: 'unknown', reason: def.notInspected, evidenceIds: [], origin: 'not_inspected' };
    if (def.check) {
      const r = def.check(technical);
      return { ...base, state: r.state, reason: r.reason, evidenceIds: [], origin: 'check' };
    }
    const c = classified[def.key];
    return c
      ? { ...base, state: c.state, reason: c.reason, evidenceIds: c.evidenceIds, origin: 'analysis' }
      : { ...base, state: 'unknown', reason: 'Bu sinyal için yeterli kanıt bulunamadı.', evidenceIds: [], origin: 'analysis' };
  });
}

/** Threshold for recommending a service: the existing "medium" score band (60+). */
export const RECOMMEND_MIN_SCORE = SCORE_BANDS.medium.min;
export const MAX_SECONDARY = 2;

export function analyzeServices(
  technical: WebsiteTechnicalSummary,
  classified: Partial<Record<ServiceKey, Partial<Record<string, SignalClassification>>>>,
  reasons: Partial<Record<ServiceKey, string>>,
): ServiceOpportunityAnalysis[] {
  const list = SERVICE_KEYS.map((service): ServiceOpportunityAnalysis => {
    const signals = buildServiceSignals(service, technical, classified[service] ?? {});
    const { score, coverage } = scoreSignals(signals);
    return {
      service,
      score,
      confidence: confidenceFromCoverage(coverage, technical.inspected),
      recommendation: 'none',
      reason: reasons[service]?.trim() || defaultReason(service, signals),
      signals,
      evidenceIds: [...new Set(signals.flatMap((s) => s.evidenceIds))],
    };
  }).sort((a, b) => b.score - a.score || SERVICE_KEYS.indexOf(a.service) - SERVICE_KEYS.indexOf(b.service));

  let secondary = 0;
  return list.map((o, i) => {
    let recommendation: Recommendation = 'none';
    if (o.score >= RECOMMEND_MIN_SCORE) {
      if (i === 0) recommendation = 'primary';
      else if (secondary < MAX_SECONDARY) {
        recommendation = 'secondary';
        secondary += 1;
      }
    }
    return { ...o, recommendation };
  });
}

function defaultReason(service: ServiceKey, signals: ServiceSignal[]): string {
  const positives = signals.filter((s) => s.state === 'positive').map((s) => s.label.toLocaleLowerCase('tr-TR'));
  if (positives.length === 0) return `${SERVICES[service].label} için destekleyici sinyal sınırlı.`;
  return `Destekleyen sinyaller: ${positives.slice(0, 3).join(', ')}.`;
}

/**
 * Overall company score (kept for Phase 2's single score):
 *   overall = round(0.75 × best service score + 0.25 × second-best service score)
 * Verification is NOT mixed in; it is shown separately and used for ranking.
 */
export function overallScore(opportunities: readonly Pick<ServiceOpportunityAnalysis, 'score'>[]): number {
  const scores = opportunities.map((o) => o.score).sort((a, b) => b - a);
  if (scores.length === 0) return 0;
  return Math.round(0.75 * scores[0] + 0.25 * (scores[1] ?? scores[0]));
}

// ---------- Verification ----------

/**
 * Verification rule:
 *   verified   = official website, location and sector all verified
 *   partial    = official website verified, or any two of the three
 *   unverified = otherwise
 * Confidence reflects what the verification rests on (provenance), not just the count:
 *   verified → high when location or sector is backed by a page KITE inspected; medium when both
 *              rest on search evidence only
 *   partial  → medium when KITE inspected the official website; low when it could not (location
 *              and sector then rest on search evidence only)
 *   unverified → low
 * A missing basis (results stored before Phase 4.2) is treated as the inspected site, as before.
 */
export function verificationStatus(
  v: Pick<CompanyVerification, 'officialWebsiteVerified' | 'locationVerified' | 'sectorVerified' | 'locationBasis' | 'sectorBasis'>,
): {
  status: VerificationStatus;
  confidence: ConfidenceLevel;
} {
  const count = [v.officialWebsiteVerified, v.locationVerified, v.sectorVerified].filter(Boolean).length;
  if (count === 3) {
    const fromSite = (b: CompanyVerification['locationBasis']) => b === undefined || b === 'inspected_site';
    return { status: 'verified', confidence: fromSite(v.locationBasis) || fromSite(v.sectorBasis) ? 'high' : 'medium' };
  }
  if (v.officialWebsiteVerified) return { status: 'partial', confidence: 'medium' };
  if (count === 2) return { status: 'partial', confidence: 'low' };
  return { status: 'unverified', confidence: 'low' };
}

// ---------- Ranking ----------

const VERIFICATION_BONUS: Record<VerificationStatus, number> = { verified: 10, partial: 0, unverified: -20 };
const CONFIDENCE_BONUS: Record<ConfidenceLevel, number> = { high: 5, medium: 0, low: -5 };
const CRITERIA_BONUS: Record<CriteriaMatch, number> = { strong: 5, partial: 0, unknown: 0, weak: -10 };

/**
 * Ranking rule for analyzed real results:
 *   rank = overall score + verification bonus (verified +10, partial 0, unverified −20)
 *        + primary-service confidence bonus (high +5, medium 0, low −5)
 *        + profile-criteria bonus (strong +5, partial/unknown 0, weak −10)
 * Higher first; ties by company name. Unanalyzed rows (failed, existing, excluded) follow.
 */
export function rankScore(input: {
  overall: number;
  verification: VerificationStatus;
  primaryConfidence: ConfidenceLevel;
  criteriaMatch: CriteriaMatch;
}): number {
  return (
    input.overall +
    VERIFICATION_BONUS[input.verification] +
    CONFIDENCE_BONUS[input.primaryConfidence] +
    CRITERIA_BONUS[input.criteriaMatch]
  );
}

export function rankScoreFor(r: {
  opportunityScore: number | null;
  verification?: CompanyVerification;
  serviceOpportunities?: ServiceOpportunityAnalysis[];
  analysis?: Pick<CompanyAnalysis, 'criteriaMatch'>;
}): number | null {
  if (r.opportunityScore === null || !r.verification || !r.serviceOpportunities?.length) return null;
  return rankScore({
    overall: r.opportunityScore,
    verification: r.verification.status,
    primaryConfidence: r.serviceOpportunities[0].confidence,
    criteriaMatch: r.analysis?.criteriaMatch ?? 'unknown',
  });
}
