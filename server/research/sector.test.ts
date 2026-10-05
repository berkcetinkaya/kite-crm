import { describe, expect, it } from 'vitest';
import { discoveryUserPrompt } from './prompts';
import { validateCriteria } from './validateRequest';

const base = { service: 'crm', country: 'United Arab Emirates', countryCode: 'AE', city: 'Dubai', companyCount: 3, criteria: '', exclusions: '' };

describe('research sector handling (Phase 5)', () => {
  it('normalizes a legacy English sector to its Turkish label and id', () => {
    expect(validateCriteria({ ...base, sector: 'Dental Clinic' }, 20)).toMatchObject({ sector: 'Diş Kliniği', sectorId: 'dental_clinic' });
  });

  it('trusts a valid sector id and ignores an unknown one', () => {
    expect(validateCriteria({ ...base, sector: 'x', sectorId: 'hotel' }, 20)).toMatchObject({ sector: 'Otel ve Konaklama', sectorId: 'hotel' });
    expect(validateCriteria({ ...base, sector: 'Drone Tarım', sectorId: 'nope' }, 20)).toMatchObject({ sector: 'Drone Tarım', sectorId: null });
  });

  it('keeps custom sectors as typed', () => {
    expect(validateCriteria({ ...base, sector: '  Kedi Oteli ' }, 20)).toMatchObject({ sector: 'Kedi Oteli', sectorId: null });
  });

  it('gives discovery the Turkish label plus internal English search terms', () => {
    const c = validateCriteria({ ...base, sector: 'Diş Kliniği' }, 20);
    const prompt = discoveryUserPrompt(c, 3, []);
    expect(prompt).toContain('Sector: Diş Kliniği');
    expect(prompt).toContain('Dental Clinic, Dental Center, Dental Practice');
    const custom = discoveryUserPrompt(validateCriteria({ ...base, sector: 'Kedi Oteli' }, 20), 3, []);
    expect(custom).toContain('Sector: Kedi Oteli');
    expect(custom).not.toContain('search terms');
  });
});
