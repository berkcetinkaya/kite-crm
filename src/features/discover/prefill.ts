// Ana Sayfa's quick research hands its values to Yeni Müşteri Bul through the URL hash.
import { readHashParams } from '../../app/useHashRoute';
import { SERVICE_KEYS, type ServiceKey } from '../../domain/services';

export interface ResearchPrefill {
  service?: ServiceKey;
  sector?: string;
  country?: string;
  city?: string;
  companyCount?: number;
}

export function discoverHref(prefill: ResearchPrefill): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(prefill)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return `#/discover${query ? `?${query}` : ''}`;
}

/** Reads and validates prefill values from the current hash; unknown values are ignored. */
export function readPrefill(): ResearchPrefill | null {
  const p = readHashParams();
  if ([...p.keys()].length === 0) return null;
  const service = p.get('service');
  const count = Number(p.get('companyCount'));
  return {
    service: service && (SERVICE_KEYS as readonly string[]).includes(service) ? (service as ServiceKey) : undefined,
    sector: p.get('sector') ?? undefined,
    country: p.get('country') ?? undefined,
    city: p.get('city') ?? undefined,
    companyCount: Number.isInteger(count) && count > 0 ? count : undefined,
  };
}

/** Drops the query from the hash without triggering navigation, so a refresh doesn't re-apply it. */
export function clearPrefillFromUrl(): void {
  window.history.replaceState(null, '', '#/discover');
}
