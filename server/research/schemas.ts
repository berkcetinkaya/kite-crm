// JSON schemas sent to the model (strict tool input / structured output) and the validators that
// re-check everything that comes back. Schemas avoid unsupported keywords (min/max lengths etc.);
// bounds are enforced in the validators instead.
import { SERVICE_KEYS, type ServiceKey } from '../../src/domain/services';
import type { EvidenceSourceType, SignalState } from '../../src/domain/research';
import { COMPANY_SIZE_ORDER, type CompanySize } from '../../src/domain/company';
import { ProviderError } from './provider';

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const strArray = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const SOURCE_TYPES: EvidenceSourceType[] = ['official_website', 'official_page', 'search_result', 'directory', 'publication', 'other'];
const LEVEL = ['high', 'medium', 'low'];
const FIT = ['strong', 'partial', 'weak', 'unknown'];
const STATES: SignalState[] = ['positive', 'neutral', 'negative', 'unknown'];

export const DISCOVERY_TOOL_NAME = 'submit_candidates';

export const DISCOVERY_TOOL_SCHEMA = obj({
  candidates: {
    type: 'array',
    items: obj({
      name: str,
      officialWebsite: nullableStr,
      city: nullableStr,
      country: str,
      sectorFit: str,
      profileFit: { type: 'string', enum: FIT },
      confidence: { type: 'string', enum: LEVEL },
      sources: {
        type: 'array',
        items: obj({ url: str, title: str, sourceType: { type: 'string', enum: SOURCE_TYPES }, claim: str }),
      },
    }),
  },
});

export const ANALYSIS_SCHEMA = obj({
  websiteMatchesCompany: { type: 'boolean' },
  websiteMatchEvidenceIds: strArray,
  locationVerified: { type: 'boolean' },
  locationEvidenceIds: strArray,
  observedCity: nullableStr,
  sectorVerified: { type: 'boolean' },
  sectorEvidenceIds: strArray,
  summary: str,
  criteriaMatch: { type: 'string', enum: FIT },
  criteriaNotes: str,
  exclusionChecks: {
    type: 'array',
    items: obj({ exclusion: str, status: { type: 'string', enum: ['violated', 'satisfied', 'unknown'] }, evidenceIds: strArray }),
  },
  companySize: { anyOf: [{ type: 'string', enum: [...COMPANY_SIZE_ORDER] }, { type: 'null' }] },
  companySizeEvidenceIds: strArray,
  signals: {
    type: 'array',
    items: obj({
      service: { type: 'string', enum: [...SERVICE_KEYS] },
      key: str,
      state: { type: 'string', enum: STATES },
      reason: str,
      evidenceIds: strArray,
    }),
  },
  serviceReasons: {
    type: 'array',
    items: obj({ service: { type: 'string', enum: [...SERVICE_KEYS] }, reason: str }),
  },
  people: {
    type: 'array',
    items: obj({ name: str, role: str, evidenceIds: strArray }),
  },
});

// ---------- validators ----------

const invalid = (what: string): never => {
  throw new ProviderError('invalid_response', `Invalid model output: ${what}`);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const asNullableStr = (v: unknown, max: number): string | null => {
  const s = asStr(v, max);
  return s ? s : null;
};
const asEnum = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const asIds = (v: unknown, known: Set<string>): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))].slice(0, 10) : [];

export interface RawCandidate {
  name: string;
  officialWebsite: string | null;
  city: string | null;
  country: string;
  sectorFit: string;
  profileFit: 'strong' | 'partial' | 'weak' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  sources: { url: string; title: string; sourceType: EvidenceSourceType; claim: string }[];
}

export function parseDiscoveryCandidates(raw: unknown, maxCandidates: number): RawCandidate[] {
  const list = isObj(raw) ? raw.candidates : raw;
  if (!Array.isArray(list)) return invalid('candidates is not an array');
  return list.slice(0, maxCandidates).flatMap((c): RawCandidate[] => {
    if (!isObj(c)) return [];
    const name = asStr(c.name, 120);
    if (!name) return [];
    return [
      {
        name,
        officialWebsite: asNullableStr(c.officialWebsite, 300),
        city: asNullableStr(c.city, 80),
        country: asStr(c.country, 80),
        sectorFit: asStr(c.sectorFit, 300),
        profileFit: asEnum(c.profileFit, ['strong', 'partial', 'weak', 'unknown'] as const, 'unknown'),
        confidence: asEnum(c.confidence, ['high', 'medium', 'low'] as const, 'low'),
        sources: Array.isArray(c.sources)
          ? c.sources.slice(0, 8).flatMap((s) =>
              isObj(s) && typeof s.url === 'string'
                ? [
                    {
                      url: s.url.trim().slice(0, 500),
                      title: asStr(s.title, 200),
                      sourceType: asEnum(s.sourceType, SOURCE_TYPES, 'other'),
                      claim: asStr(s.claim, 300),
                    },
                  ]
                : [],
            )
          : [],
      },
    ];
  });
}

export interface ParsedAnalysis {
  websiteMatchesCompany: boolean;
  websiteMatchEvidenceIds: string[];
  locationVerified: boolean;
  locationEvidenceIds: string[];
  observedCity: string | null;
  sectorVerified: boolean;
  sectorEvidenceIds: string[];
  summary: string;
  criteriaMatch: 'strong' | 'partial' | 'weak' | 'unknown';
  criteriaNotes: string;
  exclusionChecks: { exclusion: string; status: 'violated' | 'satisfied' | 'unknown'; evidenceIds: string[] }[];
  companySize: CompanySize | null;
  companySizeEvidenceIds: string[];
  signals: { service: ServiceKey; key: string; state: SignalState; reason: string; evidenceIds: string[] }[];
  serviceReasons: { service: ServiceKey; reason: string }[];
  people: { name: string; role: string; evidenceIds: string[] }[];
}

/** Validates analysis JSON. Evidence ids are filtered to ids we actually issued. */
export function parseAnalysis(raw: unknown, knownEvidenceIds: Set<string>): ParsedAnalysis {
  if (!isObj(raw)) return invalid('analysis is not an object');
  if (typeof raw.summary !== 'string' || !Array.isArray(raw.signals)) return invalid('missing summary/signals');
  const ids = (v: unknown) => asIds(v, knownEvidenceIds);
  return {
    websiteMatchesCompany: raw.websiteMatchesCompany === true,
    websiteMatchEvidenceIds: ids(raw.websiteMatchEvidenceIds),
    locationVerified: raw.locationVerified === true,
    locationEvidenceIds: ids(raw.locationEvidenceIds),
    observedCity: asNullableStr(raw.observedCity, 80),
    sectorVerified: raw.sectorVerified === true,
    sectorEvidenceIds: ids(raw.sectorEvidenceIds),
    summary: asStr(raw.summary, 600),
    criteriaMatch: asEnum(raw.criteriaMatch, ['strong', 'partial', 'weak', 'unknown'] as const, 'unknown'),
    criteriaNotes: asStr(raw.criteriaNotes, 400),
    exclusionChecks: Array.isArray(raw.exclusionChecks)
      ? raw.exclusionChecks.slice(0, 10).flatMap((e) =>
          isObj(e)
            ? [
                {
                  exclusion: asStr(e.exclusion, 200),
                  status: asEnum(e.status, ['violated', 'satisfied', 'unknown'] as const, 'unknown'),
                  evidenceIds: ids(e.evidenceIds),
                },
              ]
            : [],
        )
      : [],
    companySize: asEnum(raw.companySize, [...COMPANY_SIZE_ORDER, ''] as const, '') || null,
    companySizeEvidenceIds: ids(raw.companySizeEvidenceIds),
    signals: raw.signals.slice(0, 80).flatMap((s) =>
      isObj(s) && typeof s.key === 'string'
        ? [
            {
              service: asEnum(s.service, SERVICE_KEYS, 'crm'),
              key: s.key.slice(0, 60),
              state: asEnum(s.state, STATES, 'unknown'),
              reason: asStr(s.reason, 300),
              evidenceIds: ids(s.evidenceIds),
            },
          ]
        : [],
    ),
    serviceReasons: Array.isArray(raw.serviceReasons)
      ? raw.serviceReasons.flatMap((r) =>
          isObj(r) && (SERVICE_KEYS as readonly unknown[]).includes(r.service)
            ? [{ service: r.service as ServiceKey, reason: asStr(r.reason, 300) }]
            : [],
        )
      : [],
    people: Array.isArray(raw.people)
      ? raw.people.slice(0, 5).flatMap((p) =>
          isObj(p) && asStr(p.name, 80) ? [{ name: asStr(p.name, 80), role: asStr(p.role, 80), evidenceIds: ids(p.evidenceIds) }] : [],
        )
      : [],
  };
}
