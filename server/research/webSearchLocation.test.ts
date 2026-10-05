import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '../../src/domain/locations';
import { WEB_SEARCH_LOCATION_COUNTRIES, webSearchUserLocation } from './webSearchLocation';

describe('webSearchUserLocation', () => {
  it('sends no user_location for AE / Dubai', () => {
    expect(webSearchUserLocation({ countryCode: 'AE', city: 'Dubai' })).toBeUndefined();
  });

  it('sends a hint only for allow-listed countries, across every KITE market', () => {
    for (const country of COUNTRIES) {
      const hint = webSearchUserLocation({ countryCode: country.code, city: country.cities[0] ?? null });
      if (WEB_SEARCH_LOCATION_COUNTRIES.has(country.code)) expect(hint?.country).toBe(country.code);
      else expect(hint).toBeUndefined();
    }
  });

  it('sends nothing without a country code', () => {
    expect(webSearchUserLocation({ countryCode: null, city: 'Dubai' })).toBeUndefined();
  });

  it('builds the hint (with city) for a supported country, normalising the code', () => {
    const supported = new Set(['US']);
    expect(webSearchUserLocation({ countryCode: 'us', city: 'Austin' }, supported)).toEqual({ type: 'approximate', country: 'US', city: 'Austin' });
    expect(webSearchUserLocation({ countryCode: 'US', city: null }, supported)).toEqual({ type: 'approximate', country: 'US' });
    expect(webSearchUserLocation({ countryCode: 'AE', city: 'Dubai' }, supported)).toBeUndefined();
  });
});
