// Location hint for Anthropic's web search tool (`user_location`), decided in one place.
//
// The web search tool accepts only some country codes in `user_location` and rejects the whole
// request (400 "Country code XX is not supported") for the others; Phase 4.1 hit this with AE. The
// supported set is not published, so KITE sends a hint only for countries listed here after they
// have been confirmed to work, and omits it for every other market. Omitting the hint is always
// safe: the requested country and city are still in the discovery prompt (which tells the model to
// put them in its queries), and location/sector are verified later from evidence either way.
//
// To enable the hint for a market, add its ISO 3166-1 alpha-2 code below once a request with it
// has been confirmed to succeed. Never add a code on the assumption that it is supported.
import type { ResearchCriteria } from '../../src/domain/research';

export const WEB_SEARCH_LOCATION_COUNTRIES: ReadonlySet<string> = new Set<string>([]);

export interface WebSearchUserLocation {
  type: 'approximate';
  country: string;
  city?: string;
}

export function webSearchUserLocation(
  criteria: Pick<ResearchCriteria, 'countryCode' | 'city'>,
  supported: ReadonlySet<string> = WEB_SEARCH_LOCATION_COUNTRIES,
): WebSearchUserLocation | undefined {
  const country = criteria.countryCode?.trim().toUpperCase();
  if (!country || !supported.has(country)) return undefined;
  return { type: 'approximate', country, ...(criteria.city ? { city: criteria.city } : {}) };
}
