import type { ServiceKey } from '../../domain/services';

export interface ResearchPreset {
  sector: string;
  country: string;
  city: string;
  service: ServiceKey;
}

/** Quick-start combinations. Clicking one fills the form; it never starts research by itself. */
export const RESEARCH_PRESETS: ResearchPreset[] = [
  { sector: 'Diş Kliniği', country: 'Türkiye', city: 'İstanbul', service: 'crm' },
  { sector: 'Estetik Klinik', country: 'United Arab Emirates', city: 'Dubai', service: 'meta_ads' },
  { sector: 'Lüks Gayrimenkul', country: 'United Arab Emirates', city: 'Dubai', service: 'google_ads' },
  { sector: 'VIP Transfer', country: 'Türkiye', city: 'İstanbul', service: 'crm' },
  { sector: 'Villa Kiralama', country: 'Türkiye', city: 'Antalya', service: 'website' },
  { sector: 'Estetik Klinik', country: 'United Kingdom', city: 'London', service: 'meta_ads' },
  { sector: 'Lüks Otel', country: 'France', city: 'Paris', service: 'website' },
  { sector: 'Mücevher', country: 'Italy', city: 'Milan', service: 'creative' },
  { sector: 'Diş Kliniği', country: 'United States', city: 'Miami', service: 'google_ads' },
  { sector: 'B2B Yazılım (SaaS)', country: 'United States', city: 'New York', service: 'crm' },
];
