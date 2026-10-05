// Resolves sector intelligence for a prospect's sector. The result is always marked as
// kind: 'sector_guidance': it describes what businesses of this type commonly use a service for,
// never what this particular company does. Company facts live in Phase 4 evidence.
import { classifySector, SECTOR_FAMILIES, type SectorFamilyId } from '../sectorTaxonomy';
import type { ServiceKey } from '../services';
import { FAMILY_CRM_PROFILES, GENERIC_CRM_PROFILE, SECTOR_CRM_PROFILES, type CrmProfile, type CrmUseCase } from './crmProfiles';

export { FAMILY_CRM_PROFILES, GENERIC_CRM_PROFILE, SECTOR_CRM_PROFILES, type CrmProfile, type CrmUseCase } from './crmProfiles';

/**
 * Where the guidance came from:
 * - sector: the sector has its own profile (inherits its family's profile)
 * - family: a known sector without its own profile uses its family profile
 * - family_inferred: a custom sector clearly linked to a family uses that family profile only
 * - generic: KITE does not understand the sector; plain business CRM use cases only
 */
export type GuidanceSource = 'sector' | 'family' | 'family_inferred' | 'generic';

export interface GuidanceUseCase extends CrmUseCase {
  /** Level that contributed this use case. */
  origin: 'sector' | 'family' | 'generic';
}

export interface SectorGuidance {
  kind: 'sector_guidance';
  service: ServiceKey;
  source: GuidanceSource;
  /** Most specific profile used, e.g. "dental_clinic", "family:health" or "generic". */
  profileId: string;
  /** Profiles applied, general first. */
  chain: string[];
  sectorLabel: string;
  sectorId: string | null;
  familyId: SectorFamilyId | null;
  familyLabel: string | null;
  summaryTr: string;
  summaryEn: string;
  /** Sector-specific use cases first, then inherited ones. */
  useCases: GuidanceUseCase[];
}

/** Merges a family profile with a sector profile: sector additions first, inherited minus removals. */
function mergeProfiles(family: CrmProfile, sectorProfile: CrmProfile | null): GuidanceUseCase[] {
  const removed = new Set(sectorProfile?.removes ?? []);
  const own = (sectorProfile?.useCases ?? []).map((u) => ({ ...u, origin: 'sector' as const }));
  const ownIds = new Set(own.map((u) => u.id));
  const inherited = family.useCases
    .filter((u) => !removed.has(u.id) && !ownIds.has(u.id))
    .map((u) => ({ ...u, origin: 'family' as const }));
  return [...own, ...inherited];
}

export function resolveCrmGuidance(sector: string, sectorId?: string | null): SectorGuidance {
  const c = classifySector(sector, sectorId);
  const base = {
    kind: 'sector_guidance' as const,
    service: 'crm' as const,
    sectorLabel: c.label,
    sectorId: c.definition?.id ?? null,
    familyId: c.familyId,
    familyLabel: c.familyId ? SECTOR_FAMILIES[c.familyId].labelTr : null,
  };

  if (!c.familyId) {
    return {
      ...base,
      source: 'generic',
      profileId: GENERIC_CRM_PROFILE.id,
      chain: [GENERIC_CRM_PROFILE.id],
      summaryTr: GENERIC_CRM_PROFILE.summaryTr,
      summaryEn: GENERIC_CRM_PROFILE.summaryEn,
      useCases: GENERIC_CRM_PROFILE.useCases.map((u) => ({ ...u, origin: 'generic' as const })),
    };
  }

  const family = FAMILY_CRM_PROFILES[c.familyId];
  // Only catalogue sectors get sector-specific workflows; a custom sector never does.
  const sectorProfile = c.definition?.crmProfileId ? SECTOR_CRM_PROFILES[c.definition.crmProfileId] ?? null : null;
  const profile = sectorProfile ?? family;
  return {
    ...base,
    source: sectorProfile ? 'sector' : c.kind === 'known' ? 'family' : 'family_inferred',
    profileId: profile.id,
    chain: sectorProfile ? [family.id, sectorProfile.id] : [family.id],
    summaryTr: profile.summaryTr,
    summaryEn: profile.summaryEn,
    useCases: mergeProfiles(family, sectorProfile),
  };
}

/**
 * Sector intelligence per KITE service. CRM has the detailed sector architecture; other services
 * use Phase 4 opportunity evidence as their message basis for now. Adding a resolver here is all
 * a service needs to gain sector-specific guidance later.
 */
const SERVICE_SECTOR_INTELLIGENCE: Partial<Record<ServiceKey, (sector: string, sectorId?: string | null) => SectorGuidance>> = {
  crm: resolveCrmGuidance,
};

export function sectorGuidanceFor(service: ServiceKey, sector: string, sectorId?: string | null): SectorGuidance | null {
  return SERVICE_SECTOR_INTELLIGENCE[service]?.(sector, sectorId) ?? null;
}

export function hasSectorIntelligence(service: ServiceKey): boolean {
  return service in SERVICE_SECTOR_INTELLIGENCE;
}
