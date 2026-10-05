// Broad sector families. Related businesses share operational knowledge (see sectorIntelligence/),
// so a sector without its own CRM profile still gets sensible, family-level guidance. The goal is
// reusable business understanding, not taxonomy perfection.

export const SECTOR_FAMILY_IDS = [
  'health',
  'tourism',
  'real_estate',
  'retail',
  'professional',
  'finance',
  'education',
  'beauty',
  'automotive',
  'construction',
  'manufacturing',
  'logistics',
  'food',
  'sports',
  'events',
  'technology',
  'wholesale',
  'home_services',
  'media',
  'energy',
] as const;

export type SectorFamilyId = (typeof SECTOR_FAMILY_IDS)[number];

export interface SectorFamily {
  id: SectorFamilyId;
  /** Turkish UI label. */
  labelTr: string;
  /**
   * Extra words that point to this family when a custom sector is typed (Turkish and English,
   * whole words). Aliases and search terms of the family's sectors are used automatically too.
   */
  keywords: string[];
}

export const SECTOR_FAMILIES: Record<SectorFamilyId, SectorFamily> = {
  health: { id: 'health', labelTr: 'Sağlık', keywords: ['klinik', 'clinic', 'hastane', 'hospital', 'medical', 'medikal', 'sağlık', 'health', 'doktor', 'doctor', 'tıp', 'therapy', 'terapi', 'fizyoterapi', 'physiotherapy'] },
  tourism: { id: 'tourism', labelTr: 'Turizm ve Konaklama', keywords: ['otel', 'hotel', 'tur', 'tour', 'turizm', 'tourism', 'travel', 'seyahat', 'konaklama', 'pansiyon', 'hostel', 'tatil', 'holiday'] },
  real_estate: { id: 'real_estate', labelTr: 'Gayrimenkul', keywords: ['emlak', 'gayrimenkul', 'property', 'realty', 'konut', 'housing', 'residence', 'rezidans'] },
  retail: { id: 'retail', labelTr: 'Perakende ve E Ticaret', keywords: ['mağaza', 'store', 'shop', 'butik', 'retail', 'perakende', 'brand', 'marka', 'online'] },
  professional: { id: 'professional', labelTr: 'Profesyonel Hizmetler', keywords: ['danışmanlık', 'consulting', 'consultancy', 'advisory', 'büro', 'avukat', 'lawyer', 'agency'] },
  finance: { id: 'finance', labelTr: 'Finans ve Sigorta', keywords: ['finans', 'finance', 'sigorta', 'insurance', 'yatırım', 'investment', 'kredi', 'loan', 'bank', 'banka'] },
  education: { id: 'education', labelTr: 'Eğitim', keywords: ['okul', 'school', 'kurs', 'course', 'akademi', 'academy', 'eğitim', 'education', 'training', 'kolej', 'college'] },
  beauty: { id: 'beauty', labelTr: 'Güzellik ve Kişisel Bakım', keywords: ['güzellik', 'beauty', 'salon', 'kuaför', 'spa', 'nail', 'tırnak', 'cilt', 'skin', 'masaj', 'massage'] },
  automotive: { id: 'automotive', labelTr: 'Otomotiv', keywords: ['oto', 'auto', 'araç', 'araba', 'car', 'vehicle', 'otomotiv', 'automotive', 'motor'] },
  construction: { id: 'construction', labelTr: 'İnşaat', keywords: ['inşaat', 'construction', 'yapı', 'building', 'tadilat', 'renovation', 'müteahhit', 'contractor'] },
  manufacturing: { id: 'manufacturing', labelTr: 'Üretim', keywords: ['üretim', 'imalat', 'fabrika', 'factory', 'manufacturer', 'manufacturing', 'üretici', 'atölye'] },
  logistics: { id: 'logistics', labelTr: 'Lojistik ve Taşımacılık', keywords: ['lojistik', 'logistics', 'kargo', 'cargo', 'nakliye', 'taşımacılık', 'transport', 'freight', 'depo', 'warehouse'] },
  food: { id: 'food', labelTr: 'Yeme İçme', keywords: ['restoran', 'restaurant', 'kafe', 'cafe', 'lokanta', 'bar', 'pastane', 'bakery', 'fırın', 'yemek', 'food'] },
  sports: { id: 'sports', labelTr: 'Spor ve Fitness', keywords: ['spor', 'sport', 'fitness', 'gym', 'pilates', 'yoga', 'crossfit'] },
  events: { id: 'events', labelTr: 'Etkinlik ve Organizasyon', keywords: ['etkinlik', 'event', 'organizasyon', 'düğün', 'wedding', 'fuar', 'kongre', 'konser'] },
  technology: { id: 'technology', labelTr: 'Teknoloji', keywords: ['yazılım', 'software', 'saas', 'teknoloji', 'technology', 'tech', 'app', 'uygulama', 'platform'] },
  wholesale: { id: 'wholesale', labelTr: 'Toptan Satış ve Distribütörlük', keywords: ['toptan', 'wholesale', 'distribütör', 'distributor', 'bayi', 'dealer', 'tedarik', 'supplier', 'ithalat', 'ihracat'] },
  home_services: { id: 'home_services', labelTr: 'Ev ve Yerel Hizmetler', keywords: ['temizlik', 'cleaning', 'tamir', 'repair', 'bakım', 'maintenance', 'tesisat', 'plumbing', 'elektrikçi', 'boya', 'nakliyat'] },
  media: { id: 'media', labelTr: 'Medya ve Yaratıcı Hizmetler', keywords: ['medya', 'media', 'ajans', 'prodüksiyon', 'production', 'stüdyo', 'studio', 'reklam', 'advertising', 'tasarım', 'design'] },
  energy: { id: 'energy', labelTr: 'Enerji', keywords: ['enerji', 'energy', 'solar', 'güneş', 'elektrik', 'electric', 'şarj', 'charging'] },
};
