import { findCountry } from '../../domain/locations';
import { normalizeSectorInput, sectorLabel } from '../../domain/sectorTaxonomy';
import type { ResearchCriteria } from '../../domain/research';
import type { ServiceKey } from '../../domain/services';
import type { ResearchPrefill } from './prefill';

/** Sentinel select value that switches the country field to free text. */
export const CUSTOM_COUNTRY = '__custom__';

export const MAX_COMPANY_COUNT = 100;

export interface ResearchDraft {
  service: ServiceKey | '';
  sector: string;
  /** A country name from the list, CUSTOM_COUNTRY, or '' when nothing is chosen. */
  countryChoice: string;
  customCountry: string;
  city: string;
  companyCount: string;
  criteria: string;
  exclusions: string;
}

export const EMPTY_DRAFT: ResearchDraft = {
  service: '',
  sector: '',
  countryChoice: '',
  customCountry: '',
  city: '',
  companyCount: '20',
  criteria: '',
  exclusions: '',
};

export type DraftErrors = Partial<Record<'service' | 'sector' | 'country' | 'companyCount', string>>;

export function draftCountry(d: ResearchDraft): string {
  return (d.countryChoice === CUSTOM_COUNTRY ? d.customCountry : d.countryChoice).trim();
}

/** `maxCount` is lower for real research (server guardrail). */
export function validateDraft(d: ResearchDraft, maxCount = MAX_COMPANY_COUNT): DraftErrors {
  const errors: DraftErrors = {};
  if (!d.service) errors.service = 'Hizmet seç.';
  if (!d.sector.trim()) errors.sector = 'Sektör zorunlu.';
  if (!draftCountry(d)) errors.country = d.countryChoice === CUSTOM_COUNTRY ? 'Ülke adını yaz.' : 'Ülke seç.';
  const count = Number(d.companyCount);
  if (!d.companyCount.trim()) errors.companyCount = 'Şirket sayısı zorunlu.';
  else if (!Number.isInteger(count) || count < 1 || count > maxCount)
    errors.companyCount =
      maxCount < MAX_COMPANY_COUNT
        ? `Gerçek araştırmada 1 ile ${maxCount} arasında şirket isteyebilirsin.`
        : `1 ile ${maxCount} arasında tam sayı gir.`;
  return errors;
}

/** Only call after validateDraft returned no errors. */
export function toCriteria(d: ResearchDraft): ResearchCriteria {
  const country = draftCountry(d);
  return {
    service: d.service as ServiceKey,
    // Known sectors are stored as their Turkish label plus id; custom text is kept as typed.
    ...normalizeSectorInput(d.sector),
    country: findCountry(country)?.name ?? country,
    countryCode: findCountry(country)?.code ?? null,
    city: d.city.trim() || null,
    companyCount: Number(d.companyCount),
    criteria: d.criteria.trim(),
    exclusions: d.exclusions.trim(),
  };
}

/** Applies preset or Ana Sayfa values; a country not in the list becomes a custom country. */
export function applyPrefill(d: ResearchDraft, p: ResearchPrefill): ResearchDraft {
  const next = { ...d };
  if (p.service) next.service = p.service;
  if (p.sector !== undefined) next.sector = p.sector ? sectorLabel(p.sector) : '';
  if (p.country !== undefined) {
    const known = findCountry(p.country);
    next.countryChoice = known ? known.name : p.country ? CUSTOM_COUNTRY : '';
    next.customCountry = known ? '' : p.country;
  }
  if (p.city !== undefined) next.city = p.city;
  if (p.companyCount !== undefined) next.companyCount = String(p.companyCount);
  return next;
}
