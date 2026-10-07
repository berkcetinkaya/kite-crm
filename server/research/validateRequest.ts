// Server-side validation of research requests. The client validates too, but the server never
// trusts it: every limit is enforced here.
import { DEFAULT_DISCOVERY_FILTERS, LANGUAGE_FILTERS, WEBSITE_FILTERS, type DiscoveryFilters } from '../../src/domain/prospecting';
import { SECTOR_FAMILY_IDS } from '../../src/domain/sectorTaxonomy';
import { COMPANY_SIZE_ORDER } from '../../src/domain/company';
import type { ResearchCriteria } from '../../src/domain/research';
import type { DiscoveredCandidate } from '../../src/domain/researchApi';
import { REAL_RESEARCH_LIMITS } from '../../src/domain/researchApi';
import { SERVICE_KEYS, type ServiceKey } from '../../src/domain/services';
import { getSectorDefinition, normalizeSectorInput } from '../../src/domain/sectorTaxonomy';
import { assertPublicHttpUrl } from '../web/urlSafety';
import { validateOfficialWebsite } from './discovery';

export class RequestValidationError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, field: string, max: number, required: boolean): string {
  if (v === undefined || v === null) {
    if (required) throw new RequestValidationError(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') throw new RequestValidationError(`${field} must be a string`);
  const s = v.trim();
  if (required && !s) throw new RequestValidationError(`${field} is required`);
  if (s.length > max) throw new RequestValidationError(`${field} is too long`);
  return s;
}

export function validateCriteria(v: unknown, maxCompanies: number): ResearchCriteria {
  if (!isObj(v)) throw new RequestValidationError('criteria must be an object');
  const service = v.service;
  if (typeof service !== 'string' || !(SERVICE_KEYS as readonly string[]).includes(service)) {
    throw new RequestValidationError('invalid service');
  }
  const count = v.companyCount;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > maxCompanies) {
    throw new RequestValidationError(`companyCount must be 1–${maxCompanies}`);
  }
  const countryCode = v.countryCode;
  if (countryCode !== null && countryCode !== undefined && (typeof countryCode !== 'string' || !/^[A-Z]{2}$/.test(countryCode))) {
    throw new RequestValidationError('invalid countryCode');
  }
  const city = text(v.city, 'city', REAL_RESEARCH_LIMITS.maxShortField, false);
  // Sector: a known catalogue id wins; otherwise the text is resolved (legacy English values map to
  // their Turkish label) and custom text is kept as typed.
  const sectorText = text(v.sector, 'sector', REAL_RESEARCH_LIMITS.maxShortField, true);
  const known = getSectorDefinition(typeof v.sectorId === 'string' ? v.sectorId : null);
  const sector = known ? { sector: known.labelTr, sectorId: known.id } : normalizeSectorInput(sectorText);
  return {
    service: service as ServiceKey,
    ...sector,
    country: text(v.country, 'country', REAL_RESEARCH_LIMITS.maxShortField, true),
    countryCode: (countryCode as string | null | undefined) ?? null,
    city: city || null,
    companyCount: count,
    criteria: text(v.criteria, 'criteria', REAL_RESEARCH_LIMITS.maxTextField, false),
    exclusions: text(v.exclusions, 'exclusions', REAL_RESEARCH_LIMITS.maxTextField, false),
  };
}

/** Phase 12 run filters; missing = Phase 4 defaults. Unknown values are refused, never guessed. */
export function validateFilters(v: unknown): DiscoveryFilters {
  if (v === undefined || v === null) return { ...DEFAULT_DISCOVERY_FILTERS };
  if (!isObj(v)) throw new RequestValidationError('filters must be an object');
  const familyId = v.familyId === null || v.familyId === undefined ? null : v.familyId;
  if (familyId !== null && !(SECTOR_FAMILY_IDS as readonly unknown[]).includes(familyId)) throw new RequestValidationError('invalid familyId');
  if (!(WEBSITE_FILTERS as readonly unknown[]).includes(v.website)) throw new RequestValidationError('invalid website filter');
  if (typeof v.contactRequired !== 'boolean') throw new RequestValidationError('invalid contactRequired');
  if (!(LANGUAGE_FILTERS as readonly unknown[]).includes(v.language)) throw new RequestValidationError('invalid language filter');
  if (v.size !== 'any' && !(COMPANY_SIZE_ORDER as readonly unknown[]).includes(v.size)) throw new RequestValidationError('invalid size filter');
  return { familyId: familyId as DiscoveryFilters['familyId'], website: v.website as DiscoveryFilters['website'], contactRequired: v.contactRequired, language: v.language as DiscoveryFilters['language'], size: v.size as DiscoveryFilters['size'] };
}

export function validateJobId(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !/^rsch_[A-Za-z0-9_]{1,80}$/.test(v)) throw new RequestValidationError('invalid jobId');
  return v;
}

export function validateKnownHosts(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new RequestValidationError('knownHosts must be an array');
  return v
    .filter((h): h is string => typeof h === 'string' && /^[a-z0-9.-]{3,253}$/i.test(h))
    .slice(0, 500);
}

/**
 * Candidates come back from the client for analysis. Re-validate everything, including that the
 * website is still a safe, non-directory public URL (the client could have been tampered with).
 */
export function validateCandidates(v: unknown, maxBatch: number): DiscoveredCandidate[] {
  if (!Array.isArray(v) || v.length === 0) throw new RequestValidationError('candidates must be a non-empty array');
  if (v.length > maxBatch) throw new RequestValidationError(`at most ${maxBatch} candidates per request`);
  return v.map((c, i) => {
    if (!isObj(c)) throw new RequestValidationError(`candidate ${i} invalid`);
    // '' = no official website (allowed by the run's filters); anything else must be a valid official site.
    const rawSite = typeof c.website === 'string' ? c.website.trim() : '';
    const site = rawSite ? validateOfficialWebsite(rawSite) : { url: '', host: '' };
    if ('error' in site) throw new RequestValidationError(`candidate ${i} website invalid`);
    const evidence = Array.isArray(c.evidence) ? c.evidence.slice(0, 10) : [];
    return {
      id: text(c.id, 'id', 80, true),
      name: text(c.name, 'name', 120, true),
      website: site.url,
      city: text(c.city, 'city', 80, false) || null,
      country: text(c.country, 'country', 80, true),
      sectorFit: text(c.sectorFit, 'sectorFit', 300, false),
      profileFit: (['strong', 'partial', 'weak', 'unknown'] as const).find((x) => x === c.profileFit) ?? 'unknown',
      confidence: (['high', 'medium', 'low'] as const).find((x) => x === c.confidence) ?? 'low',
      evidence: evidence.flatMap((e) => {
        if (!isObj(e) || typeof e.url !== 'string') return [];
        try {
          assertPublicHttpUrl(e.url);
        } catch {
          return [];
        }
        return [
          {
            id: text(e.id, 'evidence.id', 10, true),
            url: e.url.slice(0, 500),
            title: text(e.title, 'evidence.title', 200, false),
            // Provenance is re-derived by the analysis (client evidence is never treated as inspected).
            sourceType: (['official_website', 'official_page', 'official_page_unfetched', 'search_result', 'directory', 'publication', 'other'] as const).find((x) => x === e.sourceType) ?? 'other',
            claim: text(e.claim, 'evidence.claim', 300, false),
            retrievedAt: text(e.retrievedAt, 'evidence.retrievedAt', 40, false) || new Date().toISOString(),
          },
        ];
      }),
    };
  });
}
