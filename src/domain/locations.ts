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
