// Research targeting markets. Country and city are separate structured values: an empty city
// means country-wide research. Both lists are suggestions; free-text values are always allowed.
import { DEFAULT_COUNTRY } from './company';

export type MarketRegion = 'turkiye' | 'gulf' | 'europe' | 'north_america';

export const MARKET_REGIONS: Record<MarketRegion, string> = {
  turkiye: 'Türkiye',
  gulf: 'Körfez',
  europe: 'Avrupa',
  north_america: 'Kuzey Amerika',
};

export const MARKET_REGION_ORDER: readonly MarketRegion[] = ['turkiye', 'gulf', 'europe', 'north_america'];

export interface Country {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** Stored on companies and research requests. */
  name: string;
  region: MarketRegion;
  cities: string[];
}

export const COUNTRIES: readonly Country[] = [
  {
    code: 'TR',
    name: DEFAULT_COUNTRY,
    region: 'turkiye',
    cities: ['İstanbul', 'İzmir', 'Antalya', 'Ankara', 'Bodrum', 'Muğla', 'Bursa', 'Adana', 'Gaziantep'],
  },
  { code: 'AE', name: 'United Arab Emirates', region: 'gulf', cities: ['Dubai', 'Abu Dhabi', 'Sharjah'] },
  { code: 'SA', name: 'Saudi Arabia', region: 'gulf', cities: ['Riyadh', 'Jeddah', 'Dammam'] },
  { code: 'QA', name: 'Qatar', region: 'gulf', cities: ['Doha'] },
  { code: 'KW', name: 'Kuwait', region: 'gulf', cities: ['Kuwait City'] },
  { code: 'BH', name: 'Bahrain', region: 'gulf', cities: ['Manama'] },
  { code: 'OM', name: 'Oman', region: 'gulf', cities: ['Muscat'] },
  { code: 'GB', name: 'United Kingdom', region: 'europe', cities: ['London', 'Manchester', 'Birmingham'] },
  { code: 'DE', name: 'Germany', region: 'europe', cities: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt'] },
  { code: 'FR', name: 'France', region: 'europe', cities: ['Paris', 'Nice', 'Lyon'] },
  { code: 'NL', name: 'Netherlands', region: 'europe', cities: ['Amsterdam', 'Rotterdam'] },
  { code: 'CH', name: 'Switzerland', region: 'europe', cities: ['Zurich', 'Geneva'] },
  { code: 'IT', name: 'Italy', region: 'europe', cities: ['Milan', 'Rome'] },
  { code: 'ES', name: 'Spain', region: 'europe', cities: ['Madrid', 'Barcelona'] },
  { code: 'AT', name: 'Austria', region: 'europe', cities: ['Vienna'] },
  { code: 'BE', name: 'Belgium', region: 'europe', cities: ['Brussels'] },
  { code: 'SE', name: 'Sweden', region: 'europe', cities: ['Stockholm'] },
  { code: 'NO', name: 'Norway', region: 'europe', cities: ['Oslo'] },
  { code: 'DK', name: 'Denmark', region: 'europe', cities: ['Copenhagen'] },
  { code: 'IE', name: 'Ireland', region: 'europe', cities: ['Dublin'] },
  { code: 'PT', name: 'Portugal', region: 'europe', cities: ['Lisbon'] },
  { code: 'GR', name: 'Greece', region: 'europe', cities: ['Athens'] },
  { code: 'LU', name: 'Luxembourg', region: 'europe', cities: ['Luxembourg'] },
  { code: 'MC', name: 'Monaco', region: 'europe', cities: ['Monaco'] },
  {
    code: 'US',
    name: 'United States',
    region: 'north_america',
    cities: [
      'New York',
      'Miami',
      'Los Angeles',
      'San Francisco',
      'Chicago',
      'Boston',
      'Dallas',
      'Houston',
      'Austin',
      'Seattle',
      'San Diego',
      'Las Vegas',
      'Washington DC',
    ],
  },
  { code: 'CA', name: 'Canada', region: 'north_america', cities: ['Toronto', 'Vancouver', 'Montreal'] },
];

export function findCountry(name: string): Country | undefined {
  const n = name.trim().toLocaleLowerCase('tr-TR');
  return COUNTRIES.find((c) => c.name.toLocaleLowerCase('tr-TR') === n);
}

/**
 * Other spellings that refer to a listed country: English/Turkish names and common abbreviations.
 * Matching is accent- and case-insensitive (see countryLookupKey). ISO codes match automatically.
 */
const COUNTRY_ALIASES: Record<string, string[]> = {
  TR: ['Turkey', 'Turkiye', 'Republic of Türkiye', 'Türkiye Cumhuriyeti'],
  AE: ['UAE', 'U.A.E.', 'United Arab Emirates (UAE)', 'Emirates', 'Birleşik Arap Emirlikleri', 'BAE'],
  SA: ['KSA', 'Kingdom of Saudi Arabia', 'Suudi Arabistan'],
  QA: ['State of Qatar', 'Katar'],
  KW: ['State of Kuwait', 'Kuveyt'],
  BH: ['Kingdom of Bahrain', 'Bahreyn'],
  OM: ['Sultanate of Oman', 'Umman'],
  GB: ['UK', 'U.K.', 'Great Britain', 'England', 'Britain', 'Birleşik Krallık', 'İngiltere'],
  DE: ['Deutschland', 'Almanya'],
  FR: ['Fransa'],
  NL: ['The Netherlands', 'Holland', 'Hollanda'],
  CH: ['Schweiz', 'Suisse', 'İsviçre'],
  IT: ['Italia', 'İtalya'],
  ES: ['España', 'İspanya'],
  AT: ['Österreich', 'Avusturya'],
  BE: ['Belçika'],
  SE: ['İsveç'],
  NO: ['Norveç'],
  DK: ['Danimarka'],
  IE: ['İrlanda'],
  PT: ['Portekiz'],
  GR: ['Yunanistan'],
  LU: ['Lüksemburg'],
  MC: [],
  US: ['USA', 'U.S.', 'U.S.A.', 'United States of America', 'America', 'ABD', 'Amerika Birleşik Devletleri'],
  CA: ['Kanada'],
};

/** Case-, accent- and punctuation-insensitive key: "U.A.E." → "uae", "Türkiye" → "turkiye". */
function countryLookupKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

const COUNTRY_BY_KEY: Map<string, Country> = (() => {
  const map = new Map<string, Country>();
  for (const c of COUNTRIES) {
    for (const v of [c.name, c.code, ...(COUNTRY_ALIASES[c.code] ?? [])]) map.set(countryLookupKey(v), c);
  }
  return map;
})();

/** Resolves a listed country from its name, ISO code or a known alias ("AE", "UAE", "Birleşik Arap Emirlikleri"). */
export function resolveCountry(value: string | null | undefined): Country | undefined {
  if (!value?.trim()) return undefined;
  return COUNTRY_BY_KEY.get(countryLookupKey(value));
}

/** The CRM value for a country: the canonical list name when known, otherwise the trimmed input. */
export function canonicalCountryName(value: string): string {
  return resolveCountry(value)?.name ?? value.trim();
}

/**
 * Comparison key for duplicate matching: the ISO code for listed countries (so "AE", "UAE" and
 * "United Arab Emirates" are equal), otherwise a normalised free-text key.
 */
export function countryMatchKey(value: string): string {
  return resolveCountry(value)?.code ?? countryLookupKey(value);
}

/**
 * Country to store on a research result. The research criteria are the source of truth: when the
 * user picked a structured country, its canonical name is used regardless of the label the model
 * returned ("AE", "UAE", …). A free-text country is canonicalised if it is a known alias.
 */
export function researchResultCountry(criteria: { country: string; countryCode: string | null }): string {
  const byCode = criteria.countryCode ? COUNTRIES.find((c) => c.code === criteria.countryCode) : undefined;
  return byCode?.name ?? canonicalCountryName(criteria.country);
}

export function citiesFor(countryName: string): string[] {
  return findCountry(countryName)?.cities ?? [];
}

/** "Dubai, United Arab Emirates", "United Arab Emirates" (country-wide) or just the city. */
export function formatLocation(city: string | null | undefined, country: string): string {
  return [city?.trim(), country.trim()].filter(Boolean).join(', ');
}

/**
 * Compact location for dense lists that historically showed only the city for Türkiye.
 * Türkiye stays implicit; other countries are always shown so international rows are unambiguous.
 */
export function formatLocationCompact(city: string, country: string): string {
  if (!country || country === DEFAULT_COUNTRY) return city || country;
  return formatLocation(city, country);
}
