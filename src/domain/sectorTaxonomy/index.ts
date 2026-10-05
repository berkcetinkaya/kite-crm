// Sector resolution: turns any stored or typed sector value (Turkish label, legacy English value,
// alias, id) into a Turkish label plus, when known, its definition and family. Unknown values are
// never rejected: they stay as typed ("custom") and may be linked to a family when the match is
// clear enough.
import { compareTr, foldForSearch } from '../../lib/text';
import { SECTOR_DEFINITIONS, type SectorDefinition } from './catalog';
import { SECTOR_FAMILIES, SECTOR_FAMILY_IDS, type SectorFamilyId } from './families';

export { SECTOR_DEFINITIONS, type SectorDefinition } from './catalog';
export { SECTOR_FAMILIES, SECTOR_FAMILY_IDS, type SectorFamily, type SectorFamilyId } from './families';
export { LEGACY_SECTOR_VALUES } from './legacy';

/** "Fertility / IVF Clinic" → "fertility ivf clinic", "E-ticaret" → "e ticaret", "Diş Kliniği" → "dis klinigi". */
export function sectorKey(value: string): string {
  return foldForSearch(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const BY_ID = new Map<string, SectorDefinition>(SECTOR_DEFINITIONS.map((d) => [d.id, d]));

/** Every name a definition answers to, keyed by sectorKey. Built once. */
const BY_KEY: Map<string, SectorDefinition> = (() => {
  const map = new Map<string, SectorDefinition>();
  for (const d of SECTOR_DEFINITIONS) {
    for (const name of [d.labelTr, ...d.searchTerms, ...d.aliases]) {
      const key = sectorKey(name);
      if (key && !map.has(key)) map.set(key, d);
    }
  }
  return map;
})();

/** Phrases that point to a family when they appear as whole words inside a custom sector. */
const FAMILY_PHRASES: { phrase: string; familyId: SectorFamilyId }[] = (() => {
  const out: { phrase: string; familyId: SectorFamilyId }[] = [];
  for (const [key, d] of BY_KEY) if (key.length >= 4) out.push({ phrase: key, familyId: d.familyId });
  for (const id of SECTOR_FAMILY_IDS) {
    for (const k of SECTOR_FAMILIES[id].keywords) out.push({ phrase: sectorKey(k), familyId: id });
  }
  return out;
})();

export function getSectorDefinition(id: string | null | undefined): SectorDefinition | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Exact resolution only: id, Turkish label, search term or alias. */
export function resolveSectorDefinition(value: string | null | undefined): SectorDefinition | undefined {
  if (!value?.trim()) return undefined;
  return BY_ID.get(value.trim()) ?? BY_KEY.get(sectorKey(value));
}

export interface SectorResolution {
  /** known: catalogue sector · family: custom text linked to a family · custom: no reliable match. */
  kind: 'known' | 'family' | 'custom';
  /** What the UI shows: the Turkish label for known sectors, the typed text otherwise. */
  label: string;
  definition: SectorDefinition | null;
  familyId: SectorFamilyId | null;
  familyLabel: string | null;
}

/**
 * Finds the family of a custom sector from whole-word phrases ("Diş Kliniği Zinciri" → Sağlık).
 * The longest matching phrase wins; a tie between different families is treated as unknown so a
 * vague entry never gets a confident family.
 */
export function inferSectorFamily(value: string): SectorFamilyId | null {
  const padded = ` ${sectorKey(value)} `;
  let best: { length: number; families: Set<SectorFamilyId> } | null = null;
  for (const { phrase, familyId } of FAMILY_PHRASES) {
    if (!padded.includes(` ${phrase} `)) continue;
    if (!best || phrase.length > best.length) best = { length: phrase.length, families: new Set([familyId]) };
    else if (phrase.length === best.length) best.families.add(familyId);
  }
  if (!best || best.families.size !== 1) return null;
  return [...best.families][0];
}

export function classifySector(value: string | null | undefined, sectorId?: string | null): SectorResolution {
  const definition = getSectorDefinition(sectorId) ?? resolveSectorDefinition(value);
  if (definition) {
    return {
      kind: 'known',
      label: definition.labelTr,
      definition,
      familyId: definition.familyId,
      familyLabel: SECTOR_FAMILIES[definition.familyId].labelTr,
    };
  }
  const label = value?.trim() ?? '';
  const familyId = label ? inferSectorFamily(label) : null;
  return {
    kind: familyId ? 'family' : 'custom',
    label,
    definition: null,
    familyId,
    familyLabel: familyId ? SECTOR_FAMILIES[familyId].labelTr : null,
  };
}

/** Turkish display label for any stored sector value; unknown values are shown as typed. */
export function sectorLabel(value: string | null | undefined, sectorId?: string | null): string {
  return classifySector(value, sectorId).label;
}

/** What to store for a typed or selected sector: the Turkish label and, when known, its id. */
export function normalizeSectorInput(value: string): { sector: string; sectorId: string | null } {
  const definition = resolveSectorDefinition(value);
  return definition ? { sector: definition.labelTr, sectorId: definition.id } : { sector: value.trim(), sectorId: null };
}

/** Turkish labels of every catalogue sector, alphabetical. Powers every sector selector. */
export const SECTOR_LABELS: readonly string[] = SECTOR_DEFINITIONS.map((d) => d.labelTr).sort(compareTr);

/** Sectors grouped by family for grouped selectors. */
export function sectorsByFamily(): { familyId: SectorFamilyId; familyLabel: string; labels: string[] }[] {
  return SECTOR_FAMILY_IDS.map((id) => ({
    familyId: id,
    familyLabel: SECTOR_FAMILIES[id].labelTr,
    labels: SECTOR_DEFINITIONS.filter((d) => d.familyId === id).map((d) => d.labelTr).sort(compareTr),
  }));
}

/** English search terms for research (internal); empty for custom sectors. */
export function sectorSearchTerms(value: string | null | undefined, sectorId?: string | null): string[] {
  return classifySector(value, sectorId).definition?.searchTerms ?? [];
}
