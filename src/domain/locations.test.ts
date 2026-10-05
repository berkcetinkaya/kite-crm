import { describe, expect, it } from 'vitest';
import { canonicalCountryName, countryMatchKey, COUNTRIES, researchResultCountry, resolveCountry } from './locations';

describe('canonical country normalization', () => {
  it('resolves UAE codes, abbreviations and Turkish names to the canonical name', () => {
    for (const v of ['AE', 'ae', 'UAE', 'U.A.E.', 'United Arab Emirates', ' united arab emirates ', 'Birleşik Arap Emirlikleri']) {
      expect(canonicalCountryName(v), v).toBe('United Arab Emirates');
    }
  });

  it('resolves other markets: United Kingdom, United States, Türkiye, Germany', () => {
    for (const v of ['GB', 'UK', 'U.K.', 'United Kingdom', 'Great Britain', 'İngiltere']) expect(canonicalCountryName(v), v).toBe('United Kingdom');
    for (const v of ['US', 'USA', 'U.S.A.', 'United States of America', 'ABD']) expect(canonicalCountryName(v), v).toBe('United States');
    for (const v of ['TR', 'Turkey', 'Türkiye', 'turkiye', 'TÜRKİYE']) expect(canonicalCountryName(v), v).toBe('Türkiye');
    for (const v of ['DE', 'Deutschland', 'Almanya']) expect(canonicalCountryName(v), v).toBe('Germany');
  });

  it('every listed country resolves from its own name and ISO code', () => {
    for (const c of COUNTRIES) {
      expect(resolveCountry(c.name)?.code).toBe(c.code);
      expect(resolveCountry(c.code)?.name).toBe(c.name);
    }
  });

  it('keeps unknown free-text countries as typed (trimmed)', () => {
    expect(canonicalCountryName('  Atlantis ')).toBe('Atlantis');
    expect(resolveCountry('')).toBeUndefined();
  });

  it('compares countries by canonical value', () => {
    expect(countryMatchKey('AE')).toBe(countryMatchKey('United Arab Emirates'));
    expect(countryMatchKey('UAE')).toBe(countryMatchKey('united arab emirates'));
    expect(countryMatchKey('UK')).toBe(countryMatchKey('United Kingdom'));
    expect(countryMatchKey('AE')).not.toBe(countryMatchKey('United Kingdom'));
    expect(countryMatchKey('Atlantis')).toBe(countryMatchKey('atlantis'));
  });

  it('research results take the country from the criteria, not the model label', () => {
    expect(researchResultCountry({ country: 'United Arab Emirates', countryCode: 'AE' })).toBe('United Arab Emirates');
    expect(researchResultCountry({ country: 'United Kingdom', countryCode: 'GB' })).toBe('United Kingdom');
    // Free-text criteria: canonicalised when it is a known alias, kept otherwise.
    expect(researchResultCountry({ country: 'UAE', countryCode: null })).toBe('United Arab Emirates');
    expect(researchResultCountry({ country: 'Atlantis', countryCode: null })).toBe('Atlantis');
  });
});
