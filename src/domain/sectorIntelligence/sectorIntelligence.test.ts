import { describe, expect, it } from 'vitest';
import { SECTOR_DEFINITIONS, SECTOR_FAMILY_IDS } from '../sectorTaxonomy';
import {
  FAMILY_CRM_PROFILES,
  GENERIC_CRM_PROFILE,
  hasSectorIntelligence,
  resolveCrmGuidance,
  SECTOR_CRM_PROFILES,
  sectorGuidanceFor,
} from '.';

const ids = (g: { useCases: { id: string }[] }) => g.useCases.map((u) => u.id);

describe('CRM sector intelligence data', () => {
  it('has a family profile for every family', () => {
    for (const f of SECTOR_FAMILY_IDS) expect(FAMILY_CRM_PROFILES[f]?.useCases.length, f).toBeGreaterThanOrEqual(5);
  });

  it('every crmProfileId in the catalogue exists, and every sector profile extends a family', () => {
    for (const d of SECTOR_DEFINITIONS) if (d.crmProfileId) expect(SECTOR_CRM_PROFILES[d.crmProfileId], d.id).toBeDefined();
    for (const p of Object.values(SECTOR_CRM_PROFILES)) {
      expect(Object.values(FAMILY_CRM_PROFILES).map((f) => f.id)).toContain(p.extends);
      // removals must refer to something the family actually has
      const family = Object.values(FAMILY_CRM_PROFILES).find((f) => f.id === p.extends)!;
      for (const r of p.removes ?? []) expect(family.useCases.map((u) => u.id), `${p.id} removes ${r}`).toContain(r);
    }
  });

  it('profiles are not one generic list copied everywhere', () => {
    const signatures = new Set(Object.values(FAMILY_CRM_PROFILES).map((p) => p.useCases.map((u) => u.tr).sort().join('|')));
    expect(signatures.size).toBe(SECTOR_FAMILY_IDS.length);
    const generic = new Set(GENERIC_CRM_PROFILE.useCases.map((u) => u.tr));
    for (const p of Object.values(FAMILY_CRM_PROFILES)) {
      const shared = p.useCases.filter((u) => generic.has(u.tr)).length;
      expect(shared / p.useCases.length, p.id).toBeLessThan(0.5);
    }
  });

  it('every use case has Turkish and English wording, and no dash punctuation', () => {
    const all = [GENERIC_CRM_PROFILE, ...Object.values(FAMILY_CRM_PROFILES), ...Object.values(SECTOR_CRM_PROFILES)];
    for (const p of all) {
      expect(p.summaryTr).toBeTruthy();
      expect(p.summaryEn).toBeTruthy();
      for (const text of [p.summaryTr, p.summaryEn, ...p.useCases.flatMap((u) => [u.tr, u.en])]) {
        expect(text, p.id).not.toMatch(/[–—]| - /);
      }
    }
  });
});

describe('inheritance and overrides', () => {
  it('dental clinic = health family + dental specifics', () => {
    const g = resolveCrmGuidance('Diş Kliniği');
    expect(g).toMatchObject({ kind: 'sector_guidance', source: 'sector', profileId: 'dental_clinic', chain: ['family:health', 'dental_clinic'], familyLabel: 'Sağlık' });
    expect(ids(g)).toEqual(expect.arrayContaining(['treatment_plans', 'treatment_stages', 'recall', 'insurance_docs', 'branch_coordination']));
    expect(ids(g)).toEqual(expect.arrayContaining(['patient_enquiries', 'appointments', 'health_payments', 'staff_tasks']));
    // sector specifics come first
    expect(g.useCases[0].origin).toBe('sector');
  });

  it('veterinary clinic extends health differently and removes patient history', () => {
    const g = resolveCrmGuidance('Veterinary Clinic');
    expect(ids(g)).toEqual(expect.arrayContaining(['pet_owner', 'vaccinations', 'recurring_checks', 'appointments']));
    expect(ids(g)).not.toContain('patient_history');
    expect(ids(g)).not.toContain('treatment_plans');
  });

  it('hotel, real estate, car rental, law firm, auto service get their own use cases', () => {
    expect(ids(resolveCrmGuidance('Hotel'))).toEqual(expect.arrayContaining(['housekeeping', 'maintenance_requests', 'supplies', 'balance_payments', 'repeat_guests']));
    expect(ids(resolveCrmGuidance('Real Estate Agency'))).toEqual(expect.arrayContaining(['portfolio_matching', 'viewings', 'agent_assignment', 'contract_stages']));
    expect(ids(resolveCrmGuidance('Car Rental'))).toEqual(expect.arrayContaining(['fleet_availability', 'deposits', 'pickup_return', 'damage_maintenance']));
    expect(ids(resolveCrmGuidance('Law Firm'))).toEqual(expect.arrayContaining(['matter_stages', 'legal_documents', 'billing']));
    expect(ids(resolveCrmGuidance('Oto Servis'))).toEqual(expect.arrayContaining(['job_orders', 'parts', 'maintenance_reminders', 'vehicle_history']));
  });

  it('a known sector without its own profile uses its family profile', () => {
    const g = resolveCrmGuidance('Logistics');
    expect(g).toMatchObject({ source: 'family', profileId: 'family:logistics' });
    expect(ids(g)).toEqual(expect.arrayContaining(['rate_quotes', 'delivery_stages', 'exceptions']));
    expect(resolveCrmGuidance('Manufacturing').profileId).toBe('family:manufacturing');
  });

  it('a legacy English value resolves to the same guidance as its Turkish label', () => {
    expect(resolveCrmGuidance('Dental Clinic')).toEqual(resolveCrmGuidance('Diş Kliniği'));
    expect(resolveCrmGuidance('anything', 'dental_clinic').profileId).toBe('dental_clinic');
  });
});

describe('custom sectors fall back safely', () => {
  it('a custom sector clearly in a family gets family guidance only, never a niche workflow', () => {
    const g = resolveCrmGuidance('Çocuk Diş Kliniği Zinciri');
    expect(g).toMatchObject({ source: 'family_inferred', profileId: 'family:health', sectorLabel: 'Çocuk Diş Kliniği Zinciri', sectorId: null });
    expect(ids(g)).not.toContain('treatment_plans');
    expect(ids(g)).not.toContain('recall');
  });

  it('an unknown sector gets the generic business profile', () => {
    const g = resolveCrmGuidance('Drone ile Tarım İlaçlama');
    expect(g).toMatchObject({ source: 'generic', profileId: 'generic', familyId: null, familyLabel: null });
    expect(ids(g)).toEqual(GENERIC_CRM_PROFILE.useCases.map((u) => u.id));
  });
});

describe('service intelligence', () => {
  it('CRM has sector intelligence; other services use Phase 4 evidence for now', () => {
    expect(hasSectorIntelligence('crm')).toBe(true);
    for (const s of ['website', 'google_ads', 'meta_ads', 'social_media', 'creative', 'seo'] as const) {
      expect(hasSectorIntelligence(s)).toBe(false);
      expect(sectorGuidanceFor(s, 'Diş Kliniği')).toBeNull();
    }
    expect(sectorGuidanceFor('crm', 'Diş Kliniği')?.profileId).toBe('dental_clinic');
  });
});
