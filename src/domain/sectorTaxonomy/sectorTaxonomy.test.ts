import { describe, expect, it } from 'vitest';
import {
  classifySector,
  inferSectorFamily,
  LEGACY_SECTOR_VALUES,
  normalizeSectorInput,
  resolveSectorDefinition,
  SECTOR_DEFINITIONS,
  SECTOR_FAMILIES,
  SECTOR_FAMILY_IDS,
  SECTOR_LABELS,
  sectorKey,
  sectorLabel,
  sectorsByFamily,
  sectorSearchTerms,
} from '.';
import { SECTORS } from '../sectors';

/** Characters that only appear in English, not Turkish words (used to spot untranslated labels). */
const ENGLISH_ONLY_WORDS = /\b(clinic|hotel|agency|company|services|real estate|rental|store|brand|travel|school|manufacturer|firm)\b/i;

describe('sector catalogue', () => {
  it('has a unique id and a unique Turkish label per definition', () => {
    const ids = SECTOR_DEFINITIONS.map((d) => d.id);
    const labels = SECTOR_DEFINITIONS.map((d) => d.labelTr);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('never lets one name resolve to two different sectors', () => {
    const owner = new Map<string, string>();
    for (const d of SECTOR_DEFINITIONS) {
      for (const name of [d.labelTr, ...d.searchTerms, ...d.aliases]) {
        const key = sectorKey(name);
        const prev = owner.get(key);
        expect(prev === undefined || prev === d.id, `"${name}" used by ${prev} and ${d.id}`).toBe(true);
        owner.set(key, d.id);
      }
    }
  });

  it('every definition has English search terms and a valid family', () => {
    for (const d of SECTOR_DEFINITIONS) {
      expect(d.searchTerms.length, d.id).toBeGreaterThan(0);
      expect(SECTOR_FAMILY_IDS).toContain(d.familyId);
    }
  });

  it('shows only Turkish labels in selectors', () => {
    expect(SECTORS).toBe(SECTOR_LABELS);
    for (const label of SECTOR_LABELS) expect(label, label).not.toMatch(ENGLISH_ONLY_WORDS);
    expect(SECTOR_LABELS.length).toBe(SECTOR_DEFINITIONS.length);
  });

  it('covers every family, and every family has at least one sector', () => {
    expect(SECTOR_FAMILY_IDS.length).toBeGreaterThanOrEqual(18);
    for (const g of sectorsByFamily()) expect(g.labels.length, g.familyId).toBeGreaterThan(0);
    for (const id of SECTOR_FAMILY_IDS) expect(SECTOR_FAMILIES[id].labelTr).toBeTruthy();
  });
});

describe('Phase 3 sector migration', () => {
  it('resolves every legacy Phase 3 value to a catalogue sector', () => {
    const missing = LEGACY_SECTOR_VALUES.filter((v) => !resolveSectorDefinition(v));
    expect(missing).toEqual([]);
  });

  it('keeps coverage: at least as many sectors as distinct legacy values', () => {
    const migrated = new Set(LEGACY_SECTOR_VALUES.map((v) => resolveSectorDefinition(v)!.id));
    // A few legacy values were Turkish/English duplicates (Dental Klinik / Dental Clinic).
    expect(migrated.size).toBeGreaterThanOrEqual(LEGACY_SECTOR_VALUES.length - 5);
    expect(SECTOR_DEFINITIONS.length).toBeGreaterThanOrEqual(migrated.size);
  });

  it('maps the requested examples to Turkish labels', () => {
    const examples: [string, string][] = [
      ['Dental Clinic', 'Diş Kliniği'],
      ['Hotel', 'Otel ve Konaklama'],
      ['Real Estate', 'Gayrimenkul'],
      ['Beauty Salon', 'Güzellik Salonu'],
      ['Law Firm', 'Hukuk Bürosu'],
      ['Car Rental', 'Araç Kiralama'],
      ['Travel Agency', 'Seyahat Acentesi'],
      ['E-commerce', 'E Ticaret'],
      ['E commerce', 'E Ticaret'],
      ['Manufacturing', 'Üretim'],
      ['Logistics', 'Lojistik'],
      ['Accounting', 'Muhasebe ve Mali Müşavirlik'],
    ];
    for (const [en, tr] of examples) expect(sectorLabel(en), en).toBe(tr);
  });

  it('resolves aliases, Turkish variants and old Phase 2 mock values', () => {
    expect(resolveSectorDefinition('Dental Klinik')?.id).toBe('dental_clinic');
    expect(resolveSectorDefinition('DİŞ KLİNİĞİ')?.id).toBe('dental_clinic');
    expect(resolveSectorDefinition('dental centre')?.id).toBe('dental_clinic');
    expect(resolveSectorDefinition('Fertility / IVF Clinic')?.id).toBe('ivf_clinic');
    expect(resolveSectorDefinition('Kitchen & Bathroom')?.id).toBe('kitchen_bathroom');
    for (const v of ['Transfer', 'Mobilya', 'Sağlık', 'E-ticaret', 'Tekne Turu', 'Evcil Hayvan', 'Yat Kiralama', 'Butik Otel', 'Tur Operatörü']) {
      expect(resolveSectorDefinition(v), v).toBeDefined();
    }
    expect(resolveSectorDefinition('dental_clinic')?.labelTr).toBe('Diş Kliniği');
  });

  it('keeps English search terms internal, for research only', () => {
    expect(sectorSearchTerms('Diş Kliniği')).toEqual(['Dental Clinic', 'Dental Center', 'Dental Practice']);
    expect(sectorSearchTerms('Kedi Kafesi Üretimi')).toEqual([]);
  });
});

describe('custom sectors', () => {
  it('preserves an unrecognized sector exactly as typed', () => {
    expect(normalizeSectorInput('  Drone ile Tarım İlaçlama  ')).toEqual({ sector: 'Drone ile Tarım İlaçlama', sectorId: null });
    expect(sectorLabel('Drone ile Tarım İlaçlama')).toBe('Drone ile Tarım İlaçlama');
    expect(classifySector('Drone ile Tarım İlaçlama').kind).toBe('custom');
  });

  it('normalizes a known sector to its Turkish label and id', () => {
    expect(normalizeSectorInput('dental clinic')).toEqual({ sector: 'Diş Kliniği', sectorId: 'dental_clinic' });
  });

  it('links a custom sector to a family only when the match is clear', () => {
    expect(inferSectorFamily('Çocuk Diş Kliniği Zinciri')).toBe('health');
    expect(inferSectorFamily('Butik Pansiyon')).toBe('tourism');
    expect(classifySector('Endüstriyel Mutfak Montaj Atölyesi').familyId).not.toBeNull();
    expect(inferSectorFamily('Kedi Oteli')).toBeNull(); // "oteli" is not the whole word "otel"
    expect(inferSectorFamily('Xyzzy Hizmetleri')).toBeNull();
    const c = classifySector('Çocuk Diş Kliniği Zinciri');
    expect(c).toMatchObject({ kind: 'family', label: 'Çocuk Diş Kliniği Zinciri', definition: null, familyLabel: 'Sağlık' });
  });
});
