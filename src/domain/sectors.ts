// Sector selector options and demo helpers. The sector catalogue itself (Turkish labels, families,
// search terms, aliases) lives in sectorTaxonomy/; this module keeps the Phase 3 entry points.
import { SECTOR_LABELS, sectorSearchTerms } from './sectorTaxonomy';

/** Turkish labels of every catalogue sector (previously a mixed English/Turkish list). */
export const SECTORS: readonly string[] = SECTOR_LABELS;

/**
 * Name groups for Phase 3 demo results only (plausible fictional company names). Not the sector
 * family taxonomy: see sectorTaxonomy/families.ts. Order matters: the first group that matches wins.
 */
export type DemoNameGroup =
  | 'dental'
  | 'aesthetic'
  | 'medical'
  | 'hospitality'
  | 'transfer'
  | 'yacht'
  | 'villa'
  | 'travel'
  | 'realestate'
  | 'interior'
  | 'fashion'
  | 'beauty'
  | 'tech'
  | 'food'
  | 'general';

const GROUP_KEYWORDS: [DemoNameGroup, string[]][] = [
  ['dental', ['dental', 'diş', 'dis klinig']],
  ['aesthetic', ['aesthetic', 'estetik', 'saç ekimi', 'hair transplant', 'plastik', 'dermatolo', 'skin', 'cosmetic center']],
  ['medical', ['clinic', 'klinik', 'hospital', 'hastane', 'medical', 'ivf', 'fertility', 'diagnostic', 'laboratory', 'radiology', 'pharmacy', 'health', 'wellness', 'spa', 'veterinary']],
  ['transfer', ['transfer', 'chauffeur', 'limousine', 'car rental', 'araç kiralama', 'fleet', 'mobility']],
  ['yacht', ['yacht', 'yat kiralama', 'marine', 'boat', 'shipyard', 'cruise']],
  ['villa', ['villa', 'holiday rental']],
  ['hospitality', ['hotel', 'otel', 'resort', 'hospitality', 'beach club', 'golf', 'ski']],
  ['travel', ['travel', 'tour', 'tur ', 'turizm', 'tourism', 'dmc', 'mice', 'excursion', 'seyahat', 'destination', 'concierge']],
  ['realestate', ['real estate', 'property', 'realty', 'leasing', 'mortgage', 'gayrimenkul', 'relocation', 'coworking', 'business center']],
  ['interior', ['interior', 'furniture', 'mobilya', 'decoration', 'kitchen', 'bathroom', 'lighting', 'architecture', 'flooring', 'marble', 'smart home', 'home automation', 'pool']],
  ['fashion', ['fashion', 'moda', 'jewel', 'watch', 'luxury retail', 'luxury goods', 'luxury brand', 'textile', 'boutique']],
  ['beauty', ['beauty', 'cosmetic', 'skincare', 'perfume', 'haircare', 'salon', 'barber']],
  ['tech', ['saas', 'software', 'it services', 'cyber', 'tech', 'fintech', 'digital']],
  ['food', ['restaurant', 'restoran', 'cafe', 'food', 'beverage', 'coffee', 'catering', 'dining']],
];

/** Matches on the Turkish label plus the English search terms, so Turkish labels keep working. */
export function demoNameGroup(sector: string): DemoNameGroup {
  const s = [sector, ...sectorSearchTerms(sector)].join(' ').toLocaleLowerCase('tr-TR');
  for (const [group, keywords] of GROUP_KEYWORDS) {
    if (keywords.some((k) => s.includes(k))) return group;
  }
  return 'general';
}
