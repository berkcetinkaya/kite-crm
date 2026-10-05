// Phase 5 mail fixtures: realistic prospects across sector families, with strong and weak
// research. All companies use the reserved ".example" TLD. Used by tests; no network, no API.
import type { MailEvidenceInput, MailGenerateRequest, MailResearchInput, MailSignalInput } from '../../src/domain/mail/context';
import type { ServiceKey } from '../../src/domain/services';

const ev = (id: string, url: string, sourceType: MailEvidenceInput['sourceType'], claim: string, title = url): MailEvidenceInput => ({ id, url, title, sourceType, claim });
const sig = (key: string, state: MailSignalInput['state'], evidenceIds: string[], origin: MailSignalInput['origin'] = 'analysis'): MailSignalInput => ({
  key,
  label: key,
  state,
  reason: `${key} gözlemi.`,
  evidenceIds,
  origin,
});

const strongResearch = (over: Partial<MailResearchInput> = {}): MailResearchInput => ({
  jobId: 'req_fixture',
  overallScore: 84,
  serviceScore: 86,
  analysisConfidence: 'high',
  verificationStatus: 'verified',
  verificationConfidence: 'high',
  websiteInspected: true,
  evidence: [],
  signals: [],
  inspectedPages: [],
  ...over,
});

const company = (name: string, sector: string, city: string, country: string, website: string, sectorId: string | null = null): MailGenerateRequest['company'] => ({
  id: `cmp_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
  name,
  website,
  sector,
  sectorId,
  city,
  country,
  opportunityScore: 80,
});

const req = (c: MailGenerateRequest['company'], service: ServiceKey, language: 'tr' | 'en', research: MailResearchInput | null, contactName: string | null = null): MailGenerateRequest => ({
  company: c,
  contactName,
  service,
  language,
  research,
});

export const MAIL_FIXTURES = {
  /** Verified multi location dental clinic in Dubai, website inspected. */
  dentalMultiLocation: req(
    company('Aurora Dental Studio', 'Diş Kliniği', 'Dubai', 'United Arab Emirates', 'https://aurora-dental.example/', 'dental_clinic'),
    'crm',
    'en',
    strongResearch({
      evidence: [
        ev('w1', 'https://aurora-dental.example/', 'official_website', 'Ana sayfa incelendi: Cosmetic dentistry clinics in Dubai Marina and Jumeirah.'),
        ev('w2', 'https://aurora-dental.example/book', 'official_page', 'Rezervasyon sayfası incelendi.'),
        ev('d1', 'https://directory.example/aurora', 'directory', 'Listed as a dental clinic in Dubai.'),
      ],
      signals: [sig('multiple_locations', 'positive', ['w1']), sig('booking_flow', 'positive', ['w2']), sig('whatsapp_contact', 'positive', [], 'check')],
    }),
    'Lena Hart',
  ),
  /** Boutique hotel in Antalya, Turkish company, Turkish mail. */
  turkishHotel: req(
    company('Kaleiçi Taş Konak', 'Butik Otel', 'Antalya', 'Türkiye', 'https://kaleici-tas-konak.example/', 'boutique_hotel'),
    'crm',
    'tr',
    strongResearch({
      evidence: [ev('w1', 'https://kaleici-tas-konak.example/', 'official_website', 'Ana sayfa incelendi: Kaleiçi’nde 12 odalı butik otel.'), ev('w2', 'https://kaleici-tas-konak.example/rezervasyon', 'official_page', 'Rezervasyon sayfası incelendi.')],
      signals: [sig('booking_flow', 'positive', ['w2'])],
    }),
  ),
  /** Real estate agency, partial verification, search sources only. */
  realEstateSearchOnly: req(
    company('Marina Gate Realty', 'Gayrimenkul Ofisi', 'Dubai', 'United Arab Emirates', 'https://marina-gate-realty.example/', 'real_estate_agency'),
    'crm',
    'en',
    strongResearch({
      verificationStatus: 'partial',
      verificationConfidence: 'low',
      analysisConfidence: 'low',
      websiteInspected: false,
      evidence: [ev('d1', 'https://marina-gate-realty.example/listings', 'official_page_unfetched', 'Lists off plan and resale apartments in Dubai Marina.'), ev('d2', 'https://portal.example/agency/marina-gate', 'directory', 'Agency profile with 14 agents.')],
      signals: [sig('service_breadth', 'positive', ['d1']), sig('high_touch_sales', 'positive', ['d2'])],
    }),
  ),
  /** Aesthetic clinic in London, Meta Ads (non CRM opportunity). */
  aestheticMetaAds: req(
    company('Belgravia Skin Clinic', 'Estetik Klinik', 'London', 'United Kingdom', 'https://belgravia-skin.example/', 'aesthetic_clinic'),
    'meta_ads',
    'en',
    strongResearch({
      evidence: [ev('w1', 'https://belgravia-skin.example/', 'official_website', 'Ana sayfa incelendi: injectables and laser treatments.')],
      signals: [sig('social_presence_linked', 'positive', [], 'check'), sig('visual_offering', 'positive', ['w1'])],
    }),
  ),
  /** Travel company, website inaccessible (Dr. Michael style). */
  travelInaccessible: req(
    company('Cappadocia Sky Tours', 'Tur Operatörü', 'Nevşehir', 'Türkiye', 'https://cappadocia-sky.example/', 'tour_operator'),
    'crm',
    'tr',
    strongResearch({
      verificationStatus: 'partial',
      verificationConfidence: 'low',
      analysisConfidence: 'low',
      websiteInspected: false,
      evidence: [ev('d1', 'https://cappadocia-sky.example/turlar', 'official_page_unfetched', 'Balon ve günübirlik turlar listeleniyor.'), ev('d2', 'https://travel-portal.example/cappadocia-sky', 'search_result', 'Günlük tur rezervasyonu alan bir operatör.')],
      signals: [sig('booking_flow', 'positive', ['d2'])],
    }),
  ),
  /** Professional services: law firm, verified. */
  lawFirm: req(
    company('Hale & Brook Legal', 'Hukuk Bürosu', 'London', 'United Kingdom', 'https://halebrook.example/', 'legal_services'),
    'crm',
    'en',
    strongResearch({
      evidence: [ev('w1', 'https://halebrook.example/', 'official_website', 'Ana sayfa incelendi: immigration and family law.'), ev('w2', 'https://halebrook.example/contact', 'official_page', 'İletişim sayfası incelendi: consultation request form.')],
      signals: [sig('lead_or_quote_forms', 'positive', ['w2']), sig('high_touch_sales', 'positive', ['w1'])],
    }),
  ),
  /** Manufacturing company in Bursa, Turkish. */
  manufacturing: req(
    company('Uludağ Ambalaj', 'Ambalaj', 'Bursa', 'Türkiye', 'https://uludag-ambalaj.example/', 'packaging'),
    'crm',
    'tr',
    strongResearch({
      evidence: [ev('w1', 'https://uludag-ambalaj.example/', 'official_website', 'Ana sayfa incelendi: oluklu mukavva ve özel baskılı ambalaj.'), ev('w2', 'https://uludag-ambalaj.example/teklif', 'official_page', 'Teklif formu incelendi.')],
      signals: [sig('lead_or_quote_forms', 'positive', ['w2'])],
    }),
  ),
  /** Logistics company, no useful evidence (weak research). */
  logisticsNoEvidence: req(
    company('Marmara Lojistik', 'Lojistik', 'İstanbul', 'Türkiye', 'https://marmara-lojistik.example/', 'logistics'),
    'crm',
    'tr',
    strongResearch({ verificationStatus: 'unverified', verificationConfidence: 'low', analysisConfidence: 'low', websiteInspected: false, evidence: [], signals: [] }),
  ),
  /** Custom sector KITE does not know; no research. */
  customUnknown: req(company('Skyfield Agro Drones', 'Drone ile Tarım İlaçlama', 'Konya', 'Türkiye', 'https://skyfield-agro.example/'), 'crm', 'tr', null),
  /** Company added manually, no research at all, English. */
  noResearch: req(company('Harbor Smile', 'Diş Kliniği', 'Miami', 'United States', 'https://harbor-smile.example/', 'dental_clinic'), 'crm', 'en', null),
  /** Website service for an inspected site with a missing mobile viewport (non CRM). */
  websiteOpportunity: req(
    company('Ege Villa Rentals', 'Villa Kiralama', 'Bodrum', 'Türkiye', 'https://ege-villa.example/', 'villa_rental'),
    'website',
    'tr',
    strongResearch({ evidence: [ev('w1', 'https://ege-villa.example/', 'official_website', 'Ana sayfa incelendi.')], signals: [sig('missing_viewport', 'positive', [], 'check')] }),
  ),
} satisfies Record<string, MailGenerateRequest>;
