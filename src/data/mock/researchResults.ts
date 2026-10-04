// Demo research results for Phase 3. Every company here is fictional and nothing is looked up
// online. Results are deterministic for the same criteria so a demo can be repeated.
import { COMPANY_SIZE_ORDER, type CompanySize } from '../../domain/company';
import { citiesFor, findCountry } from '../../domain/locations';
import type { ResearchCriteria, ResearchResult } from '../../domain/research';
import { sectorFamily, type SectorFamily } from '../../domain/sectors';
import type { ServiceKey } from '../../domain/services';
import { createId } from '../../lib/id';
import { foldForSearch } from '../../lib/text';

/** Upper bound on demo rows; the UI states when fewer than the requested count are shown. */
export const MAX_DEMO_RESULTS = 8;

interface CatalogEntry {
  name: string;
  website: string;
  family: SectorFamily;
  country: string;
  city: string;
}

// Hand-written fictional companies. The Türkiye entries share names/websites with the Phase 2 mock
// prospects on purpose, so duplicate detection ("Zaten Listede") can be demonstrated.
const CATALOG: CatalogEntry[] = [
  { name: 'Istanbul Smile Center', website: 'istanbulsmilecenter.com', family: 'dental', country: 'Türkiye', city: 'İstanbul' },
  { name: 'DentGlow Clinic', website: 'dentglow.com.tr', family: 'dental', country: 'Türkiye', city: 'İstanbul' },
  { name: 'Bosphorus Transfer', website: 'bosphorustransfer.com', family: 'transfer', country: 'Türkiye', city: 'İstanbul' },
  { name: 'TRVIP Transfer', website: 'trvip.com.tr', family: 'transfer', country: 'Türkiye', city: 'Antalya' },
  { name: 'Nova Villas', website: 'novavillas.com', family: 'villa', country: 'Türkiye', city: 'Antalya' },
  { name: 'Dubai Smile Studio', website: 'dubaismilestudio.ae', family: 'dental', country: 'United Arab Emirates', city: 'Dubai' },
  { name: 'Riyadh Aesthetic Center', website: 'riyadhaesthetic.sa', family: 'aesthetic', country: 'Saudi Arabia', city: 'Riyadh' },
  { name: 'Doha Executive Travel', website: 'dohaexecutivetravel.qa', family: 'transfer', country: 'Qatar', city: 'Doha' },
  { name: 'Kuwait Luxury Interiors', website: 'kuwaitluxuryinteriors.com.kw', family: 'interior', country: 'Kuwait', city: 'Kuwait City' },
  { name: 'Manama Wellness Clinic', website: 'manamawellness.bh', family: 'medical', country: 'Bahrain', city: 'Manama' },
  { name: 'Muscat Private Travel', website: 'muscatprivatetravel.om', family: 'travel', country: 'Oman', city: 'Muscat' },
  { name: 'Mayfair Dental Group', website: 'mayfairdentalgroup.co.uk', family: 'dental', country: 'United Kingdom', city: 'London' },
  { name: 'Berlin Interior Haus', website: 'berlininteriorhaus.de', family: 'interior', country: 'Germany', city: 'Berlin' },
  { name: 'Amsterdam Skin Lab', website: 'amsterdamskinlab.nl', family: 'aesthetic', country: 'Netherlands', city: 'Amsterdam' },
  { name: 'Zurich Private Clinic', website: 'zurichprivateclinic.ch', family: 'medical', country: 'Switzerland', city: 'Zurich' },
  { name: 'Milan Luxury Living', website: 'milanluxuryliving.it', family: 'interior', country: 'Italy', city: 'Milan' },
  { name: 'Madrid Aesthetic Studio', website: 'madridaestheticstudio.es', family: 'aesthetic', country: 'Spain', city: 'Madrid' },
  { name: 'Paris Executive Travel', website: 'parisexecutivetravel.fr', family: 'transfer', country: 'France', city: 'Paris' },
  { name: 'Vienna Dental Group', website: 'viennadentalgroup.at', family: 'dental', country: 'Austria', city: 'Vienna' },
  { name: 'Stockholm Design House', website: 'stockholmdesignhouse.se', family: 'interior', country: 'Sweden', city: 'Stockholm' },
  { name: 'Oslo Wellness Clinic', website: 'oslowellnessclinic.no', family: 'medical', country: 'Norway', city: 'Oslo' },
  { name: 'Dublin Property Partners', website: 'dublinpropertypartners.ie', family: 'realestate', country: 'Ireland', city: 'Dublin' },
  { name: 'Miami Luxury Realty', website: 'miamiluxuryrealty.com', family: 'realestate', country: 'United States', city: 'Miami' },
  { name: 'Manhattan Cosmetic Center', website: 'manhattancosmeticcenter.com', family: 'aesthetic', country: 'United States', city: 'New York' },
  { name: 'Beverly Hills Dental Studio', website: 'beverlyhillsdentalstudio.com', family: 'dental', country: 'United States', city: 'Los Angeles' },
  { name: 'Austin B2B Systems', website: 'austinb2bsystems.com', family: 'tech', country: 'United States', city: 'Austin' },
  { name: 'Toronto Property Group', website: 'torontopropertygroup.ca', family: 'realestate', country: 'Canada', city: 'Toronto' },
  { name: 'Vancouver Aesthetic Clinic', website: 'vancouveraesthetic.ca', family: 'aesthetic', country: 'Canada', city: 'Vancouver' },
];

const FAMILY_NOUNS: Record<SectorFamily, string[]> = {
  dental: ['Smile Studio', 'Dental Group', 'Dental Clinic', 'Smile Center', 'Dental Studio', 'Dental Care'],
  aesthetic: ['Aesthetic Clinic', 'Skin Lab', 'Aesthetic Studio', 'Laser Clinic', 'Cosmetic Center', 'Beauty Clinic'],
  medical: ['Private Clinic', 'Health Center', 'Medical Group', 'Wellness Clinic', 'Care Clinic'],
  hospitality: ['Boutique Hotel', 'Grand Hotel', 'Resort & Spa', 'Suites', 'Hotel Collection'],
  transfer: ['Executive Transfer', 'Chauffeur Services', 'VIP Transfer', 'Private Drivers', 'Limousine'],
  yacht: ['Yacht Charter', 'Yachting', 'Marine', 'Boat Club', 'Sailing'],
  villa: ['Villas', 'Holiday Homes', 'Villa Collection', 'Retreats', 'Stays'],
  travel: ['Travel', 'Tours', 'Journeys', 'Travel Collection', 'Destination Management'],
  realestate: ['Luxury Realty', 'Property Group', 'Estates', 'Property Partners', 'Homes'],
  interior: ['Interior Haus', 'Design House', 'Interiors', 'Living', 'Furniture Studio'],
  fashion: ['Atelier', 'Boutique', 'Jewellers', 'Fashion House', 'Collection'],
  beauty: ['Beauty Lab', 'Cosmetics', 'Skin Co.', 'Beauty Studio', 'Hair Studio'],
  tech: ['Systems', 'Software', 'Cloud', 'Labs', 'Digital'],
  food: ['Kitchen', 'Dining Group', 'Café', 'Bistro', 'Food Co.'],
  general: ['Group', 'Partners', 'Studio', 'Co.', 'Collective'],
};

// Neighbourhood-style prefixes make generated names read like their market.
const CITY_PREFIXES: Record<string, string[]> = {
  İstanbul: ['Istanbul', 'Bosphorus', 'Nişantaşı', 'Bebek', 'Kadıköy'],
  Antalya: ['Antalya', 'Lara', 'Konyaaltı', 'Kaş'],
  İzmir: ['Izmir', 'Alsancak', 'Karşıyaka'],
  Bodrum: ['Bodrum', 'Yalıkavak', 'Türkbükü'],
  Dubai: ['Dubai', 'Jumeirah', 'Marina', 'Palm'],
  'Abu Dhabi': ['Abu Dhabi', 'Saadiyat', 'Yas'],
  Riyadh: ['Riyadh', 'Olaya', 'Diplomatic Quarter'],
  Jeddah: ['Jeddah', 'Corniche', 'Red Sea'],
  Doha: ['Doha', 'West Bay', 'The Pearl'],
  London: ['Mayfair', 'Chelsea', 'Kensington', 'London'],
  Paris: ['Paris', 'Marais', 'Rive Gauche'],
  Berlin: ['Berlin', 'Mitte', 'Charlottenburg'],
  Munich: ['Munich', 'Schwabing', 'Isar'],
  Amsterdam: ['Amsterdam', 'Canal', 'Zuid'],
  Zurich: ['Zurich', 'Seefeld', 'Bahnhofstrasse'],
  Milan: ['Milan', 'Brera', 'Navigli'],
  Madrid: ['Madrid', 'Salamanca', 'Retiro'],
  Barcelona: ['Barcelona', 'Eixample', 'Gràcia'],
  'New York': ['Manhattan', 'Brooklyn', 'Hudson', 'SoHo'],
  'Los Angeles': ['Beverly Hills', 'Santa Monica', 'Malibu'],
  Miami: ['Miami', 'Brickell', 'South Beach', 'Coral Gables'],
  Toronto: ['Toronto', 'Yorkville', 'Liberty'],
  Vancouver: ['Vancouver', 'Kitsilano', 'Coal Harbour'],
};

const COUNTRY_TLD: Record<string, string> = {
  TR: 'com.tr',
  AE: 'ae',
  SA: 'sa',
  QA: 'qa',
  KW: 'com.kw',
  BH: 'bh',
  OM: 'om',
  GB: 'co.uk',
  DE: 'de',
  FR: 'fr',
  NL: 'nl',
  CH: 'ch',
  IT: 'it',
  ES: 'es',
  AT: 'at',
  BE: 'be',
  SE: 'se',
  NO: 'no',
  DK: 'dk',
  IE: 'ie',
  PT: 'pt',
  GR: 'gr',
  LU: 'lu',
  MC: 'mc',
  US: 'com',
  CA: 'ca',
};

// Phrased as hypotheses to check, never as findings: nothing was actually analysed.
const SERVICE_REASONS: Record<ServiceKey, string[]> = {
  crm: [
    'Randevu ve rezervasyon akışı birden fazla kanalda yürüyor olabilir.',
    'Teklif ağırlıklı satış süreci; takip adımları manuel olabilir.',
    'Çok şubeli yapı, ortak müşteri takibi ihtiyacı doğurabilir.',
    'WhatsApp ağırlıklı iletişim; lead kaybı riski olabilir.',
  ],
  website: [
    'Premium konumlanma ile site deneyimi uyumsuz olabilir.',
    'Mobil form ve rezervasyon akışı zayıf olabilir.',
    'Güven unsurları ve CTA’lar öne çıkmıyor olabilir.',
    'Site yapısı hizmetleri net anlatmıyor olabilir.',
  ],
  google_ads: [
    'Yüksek bilet değerli, aranan bir hizmet; ücretli arama fırsatı olabilir.',
    'Yerel arama niyeti güçlü bir kategori.',
    'Ölçülebilir lead üretimine uygun bir iş modeli.',
    'Rakiplerin reklam verdiği işlem odaklı aramalar olabilir.',
  ],
  meta_ads: [
    'Görsel anlatıma çok uygun bir ürün / hizmet.',
    'Remarketing potansiyeli yüksek bir müşteri yolculuğu.',
    'Kampanya ve teklif odaklı iletişime uygun.',
    'Özendirici, premium bir kategori.',
  ],
  social_media: [
    'Paylaşım düzeni ve görsel tutarlılık geliştirilebilir olabilir.',
    'Reels ve kısa video kullanımı zayıf olabilir.',
    'Marka hikâyesi içeriklerde yeterince anlatılmıyor olabilir.',
    'Kampanya iletişimi düzensiz olabilir.',
  ],
  creative: [
    'Reklam görselleri tekrar ediyor olabilir.',
    'Teklif sunumu ve ilk saniye kancaları zayıf olabilir.',
    'Görsel dil kategorinin premium algısının gerisinde olabilir.',
    'Kreatif çeşitliliği düşük olabilir.',
  ],
  seo: [
    'Şehir / hizmet bazlı açılış sayfası potansiyeli olabilir.',
    'Bilgi amaçlı arama talebi yüksek bir kategori.',
    'Yerel SEO fırsatları değerlendirilmiyor olabilir.',
    'Kategori içeriklerinde boşluklar olabilir.',
  ],
};

/** Small deterministic hash so the same criteria give the same demo output. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function slug(text: string): string {
  return foldForSearch(text).replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

function excludedTerms(exclusions: string): string[] {
  return exclusions
    .split(/[\n,;]/)
    .map((t) => foldForSearch(t.trim()))
    .filter((t) => t.length >= 3);
}

interface Candidate {
  name: string;
  website: string;
  city: string | null;
}

export function generateDemoResults(request: ResearchCriteria & { id: string }): ResearchResult[] {
  const family = sectorFamily(request.sector);
  const country = findCountry(request.country);
  const countryName = request.country.trim();
  const city = request.city?.trim() || null;
  const wanted = Math.min(request.companyCount, MAX_DEMO_RESULTS);
  const seed = hash(`${request.service}|${request.sector}|${countryName}|${city ?? ''}`);
  const excluded = excludedTerms(request.exclusions);
  const isExcluded = (c: Candidate) =>
    excluded.some((t) => foldForSearch(c.name).includes(t) || c.website.includes(t));

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const push = (c: Candidate) => {
    const key = foldForSearch(c.name);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };

  // 1) Catalogue companies in the same market and sector family.
  for (const e of CATALOG) {
    const sameCountry = foldForSearch(e.country) === foldForSearch(countryName);
    const sameCity = !city || foldForSearch(e.city) === foldForSearch(city);
    if (sameCountry && sameCity && e.family === family) push({ name: e.name, website: e.website, city: e.city });
  }

  // 2) Generated names for the rest, spread over the country's cities for country-wide research.
  const cities = city ? [city] : citiesFor(countryName).slice(0, 4);
  const places = cities.length ? cities : [countryName];
  const nouns = family === 'general' ? FAMILY_NOUNS.general.map((n) => `${request.sector.trim()} ${n}`) : FAMILY_NOUNS[family];
  const tld = country ? COUNTRY_TLD[country.code] ?? 'com' : 'com';

  for (let i = 0; candidates.length < wanted + excluded.length + 4 && i < 40; i++) {
    const place = places[(seed + i) % places.length];
    const prefixes = CITY_PREFIXES[place] ?? [place];
    const prefix = prefixes[(seed + i * 7) % prefixes.length];
    const noun = nouns[(seed + i * 3) % nouns.length];
    const name = `${prefix} ${noun}`;
    push({ name, website: `${slug(name)}.${tld}`, city: city ?? (cities.length ? place : null) });
  }

  const reasons = SERVICE_REASONS[request.service];
  return candidates
    .filter((c) => !isExcluded(c))
    .slice(0, wanted)
    .map((c, i): ResearchResult => {
      const h = hash(`${c.name}|${request.service}`);
      return {
        id: createId('res'),
        researchRequestId: request.id,
        companyName: c.name,
        website: c.website,
        sector: request.sector.trim(),
        city: c.city,
        country: countryName,
        source: 'demo',
        service: request.service,
        opportunityScore: 55 + (h % 40),
        reason: reasons[(seed + i) % reasons.length],
        companySize: COMPANY_SIZE_ORDER[h % 3] as CompanySize,
        confidence: 'medium',
        selected: false,
        alreadyInProspects: false,
        transferredCompanyId: null,
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
}
