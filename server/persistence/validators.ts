// Payload validators for the persistence API. They mirror the domain types; anything the browser
// sends is checked here before a service touches the store. Ids of new records, timestamps of
// mutations, history entries and transfer links are always issued by the server, never taken
// from the payload.
import {
  COMPANY_SIZE_ORDER,
  COMPANY_SOURCE_ORDER,
  CONTACT_CONFIDENCE_ORDER,
  POTENTIAL_ORDER,
  TEAM_MEMBERS,
  type CompanySize,
  type ServiceOpportunity,
} from '../../src/domain/company';
import type { MailLanguage } from '../../src/domain/mail/draft';
import { RESEARCH_STATUS_ORDER, REAL_RESEARCH_STAGES, type ResearchRequest, type ResearchResult } from '../../src/domain/research';
import { SALES_STATUS_ORDER, type SalesStatus } from '../../src/domain/salesStatus';
import { getSectorDefinition, normalizeSectorInput } from '../../src/domain/sectorTaxonomy';
import { SERVICE_KEYS, type ServiceKey } from '../../src/domain/services';
import type { ContactInput, NewCompanyInput } from '../../src/state/companies/companyCommands';
import type { CompanyDetailsPatch } from '../../src/state/companies/companiesReducer';
import { isValidEmail, normalizePhone } from '../../src/lib/email';
import { arr, bool, DataError, httpUrl, id, isoDate, nullable, num, obj, oneOf, optional, str, type Validator } from './schema';

const LEVELS = ['high', 'medium', 'low'] as const;
const EVIDENCE_TYPES = ['official_website', 'official_page', 'official_page_unfetched', 'search_result', 'directory', 'publication', 'other'] as const;
const score = nullable(num(0, 100, { int: true }));
const longText = str(4000, { trim: false });

const owner: Validator<string | null> = (v, p) => {
  const o = nullable(str(120))(v, p);
  if (o !== null && !(TEAM_MEMBERS as readonly string[]).includes(o)) throw new DataError('invalid_request', 'Sorumlu kişi tanınmıyor.', `${p}: unknown owner`);
  return o;
};

// ---------- Companies ----------

const opportunity = obj({
  service: oneOf(SERVICE_KEYS),
  score,
  potential: nullable(oneOf(POTENTIAL_ORDER)),
  reason: str(1000),
});

export const opportunities: Validator<ServiceOpportunity[]> = (v, p) => {
  const list = arr(opportunity, SERVICE_KEYS.length)(v, p) as ServiceOpportunity[];
  if (new Set(list.map((o) => o.service)).size !== list.length) throw new DataError('invalid_request', 'Aynı hizmet iki kez eklenemez.', `${p}: duplicate service`);
  return list;
};

/** Optional email: empty → null; otherwise it must be a real address (never guessed or repaired). */
const email: Validator<string | null> = (v, p) => {
  const s = nullable(str(254))(v, p);
  if (!s) return null;
  if (!isValidEmail(s)) throw new DataError('invalid_request', 'Geçerli bir e-posta adresi gir.', `${p}: invalid email`);
  return s;
};

/** Optional free-form phone: trimmed, whitespace collapsed; empty → null. */
const phone: Validator<string | null> = (v, p) => normalizePhone(nullable(str(60))(v, p));

export const contactInput: Validator<ContactInput> = obj({
  fullName: str(120, { min: 1 }),
  role: str(120),
  email,
  phone,
  linkedin: nullable(str(300)),
  isDecisionMaker: bool,
  confidence: oneOf(CONTACT_CONFIDENCE_ORDER),
}) as Validator<ContactInput>;

const researchRef = obj({
  requestId: id,
  requestName: str(200),
  mode: oneOf(['demo', 'real'] as const),
  researchedAt: isoDate,
  sourceUrls: arr(str(500), 10),
  sources: optional(arr(obj({ url: str(500), title: str(300), sourceType: oneOf(EVIDENCE_TYPES) }), 10)),
});

export const newCompanyInput: Validator<NewCompanyInput> = (v, p) => {
  const input = obj({
    name: str(120, { min: 1 }),
    website: nullable(str(300)),
    sector: str(120, { min: 1 }),
    city: str(80),
    country: str(120, { min: 1 }),
    source: oneOf(COMPANY_SOURCE_ORDER),
    opportunities,
    opportunityScore: score,
    status: oneOf(SALES_STATUS_ORDER),
    owner,
    note: str(4000),
    companySize: optional(nullable(oneOf(COMPANY_SIZE_ORDER))),
    origin: optional(str(300)),
    createdMessage: optional(str(200)),
    contacts: optional(arr(contactInput, 20)),
    researchRef: optional(researchRef),
  })(v, p);
  return input as NewCompanyInput;
};

export const detailsPatch: Validator<CompanyDetailsPatch> = (v, p) => {
  const patch = obj({
    name: optional(str(120, { min: 1 })),
    website: optional(nullable(str(300))),
    sector: optional(str(120, { min: 1 })),
    city: optional(str(80)),
    country: optional(str(120, { min: 1 })),
    companySize: optional(nullable(oneOf<CompanySize>(COMPANY_SIZE_ORDER))),
    source: optional(oneOf(COMPANY_SOURCE_ORDER)),
    owner: optional(owner),
    status: optional(oneOf<SalesStatus>(SALES_STATUS_ORDER)),
    opportunityScore: optional(score),
    lastContactAt: optional(nullable(isoDate)),
    nextAction: optional(nullable(obj({ label: str(200, { min: 1 }), dueAt: nullable(isoDate) }))),
  })(v, p) as CompanyDetailsPatch;
  // Sector id always follows the sector text (never trusted from the client).
  return patch.sector === undefined ? patch : { ...patch, ...normalizeSectorInput(patch.sector) };
};

export const status: Validator<SalesStatus> = oneOf(SALES_STATUS_ORDER);

// ---------- Research ----------

const progress = obj({
  stage: oneOf(REAL_RESEARCH_STAGES),
  candidates: num(0, 1000, { int: true }),
  toAnalyze: num(0, 1000, { int: true }),
  inspected: num(0, 1000, { int: true }),
  analyzed: num(0, 1000, { int: true }),
  failed: num(0, 1000, { int: true }),
});

export const researchJob: Validator<ResearchRequest> = (v, p) => {
  const j = obj({
    id,
    name: str(200, { min: 1 }),
    status: oneOf(RESEARCH_STATUS_ORDER),
    mode: oneOf(['demo', 'real'] as const),
    provider: nullable(oneOf(['anthropic', 'fixture'] as const)),
    service: oneOf(SERVICE_KEYS),
    sector: str(120, { min: 1 }),
    sectorId: optional(nullable(str(80))),
    country: str(120, { min: 1 }),
    countryCode: nullable(str(2, { min: 2 })),
    city: nullable(str(80)),
    companyCount: num(1, 100, { int: true }),
    criteria: str(1000),
    exclusions: str(1000),
    resultCount: num(0, 1000, { int: true }),
    progress: nullable(progress),
    errorMessage: nullable(str(500)),
    cancelled: bool,
    createdAt: isoDate,
    updatedAt: isoDate,
    startedAt: nullable(isoDate),
    completedAt: nullable(isoDate),
  })(v, p);
  const known = getSectorDefinition(j.sectorId ?? null);
  const sector = known ? { sector: known.labelTr, sectorId: known.id } : normalizeSectorInput(j.sector);
  return { ...j, ...sector, isDemo: j.mode === 'demo' } as ResearchRequest;
};

const evidence = obj({ id: str(12, { min: 1 }), url: httpUrl, title: str(300), sourceType: oneOf(EVIDENCE_TYPES), claim: str(1000), retrievedAt: isoDate });

const signal = obj({
  key: str(60, { min: 1 }),
  label: str(120),
  state: oneOf(['positive', 'neutral', 'negative', 'unknown'] as const),
  reason: str(1000),
  evidenceIds: arr(str(12), 20),
  origin: oneOf(['check', 'analysis', 'not_inspected'] as const),
  weight: num(0, 100),
});

const serviceOpportunity = obj({
  service: oneOf(SERVICE_KEYS),
  score: num(0, 100, { int: true }),
  confidence: oneOf(LEVELS),
  recommendation: oneOf(['primary', 'secondary', 'none'] as const),
  reason: str(1000),
  signals: arr(signal, 40),
  evidenceIds: arr(str(12), 60),
});

const verification = obj({
  status: oneOf(['verified', 'partial', 'unverified'] as const),
  confidence: oneOf(LEVELS),
  officialWebsiteVerified: bool,
  locationVerified: bool,
  sectorVerified: bool,
  locationBasis: optional(nullable(oneOf(['inspected_site', 'search_only'] as const))),
  sectorBasis: optional(nullable(oneOf(['inspected_site', 'search_only'] as const))),
  verified: arr(str(500), 20),
  unverified: arr(str(500), 20),
  evidenceIds: arr(str(12), 60),
});

const analysis = obj({
  summary: str(4000),
  criteriaMatch: oneOf(['strong', 'partial', 'weak', 'unknown'] as const),
  criteriaNotes: str(2000),
  exclusionChecks: arr(obj({ exclusion: str(300), status: oneOf(['violated', 'satisfied', 'unknown'] as const), evidenceIds: arr(str(12), 20) }), 20),
  websiteInspected: bool,
  warnings: arr(str(500), 20),
});

const contactHint = obj({
  kind: oneOf(['email', 'phone', 'whatsapp', 'contact_page', 'person'] as const),
  value: str(500),
  role: nullable(str(200)),
  evidenceIds: arr(str(12), 20),
  confidence: oneOf(LEVELS),
});

/** Website facts are measured by the server; only their shape and size are checked here. */
const technical: Validator<Record<string, unknown>> = (v, p) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DataError('invalid_request', 'Gönderilen bilgiler geçersiz.', `${p}: must be an object`);
  if (JSON.stringify(v).length > 20_000) throw new DataError('invalid_request', 'Gönderilen bilgiler geçersiz.', `${p}: too large`);
  return v as Record<string, unknown>;
};

export const researchResult: Validator<ResearchResult> = (v, p) =>
  obj({
    id,
    companyName: str(200, { min: 1 }),
    website: nullable(str(500)),
    sector: str(120),
    city: nullable(str(80)),
    country: str(120),
    source: oneOf(['demo', 'web'] as const),
    service: oneOf(SERVICE_KEYS),
    opportunityScore: score,
    reason: str(2000),
    companySize: nullable(oneOf(COMPANY_SIZE_ORDER)),
    confidence: oneOf(LEVELS),
    selected: bool,
    alreadyInProspects: bool,
    researchStatus: oneOf(['demo', 'discovered', 'analyzed', 'failed', 'existing', 'excluded'] as const),
    createdAt: isoDate,
    discovery: optional(obj({ sectorFit: str(1000), profileFit: oneOf(['strong', 'partial', 'weak', 'unknown'] as const), confidence: oneOf(LEVELS) })),
    verification: optional(verification),
    evidence: optional(arr(evidence, 40)),
    analysis: optional(analysis),
    serviceOpportunities: optional(arr(serviceOpportunity, SERVICE_KEYS.length)),
    contactHints: optional(arr(contactHint, 40)),
    technical: optional(technical),
    analysisError: optional(nullable(str(500))),
    rankScore: optional(num(-1000, 1000)),
    // transferredCompanyId is never accepted from the browser: only the transfer endpoint sets it.
  })(v, p) as unknown as ResearchResult;

// ---------- Mail ----------

export const generateOptions = obj({
  companyId: id,
  service: oneOf<ServiceKey>(SERVICE_KEYS),
  language: oneOf<MailLanguage>(['tr', 'en']),
  contactId: nullable(id),
  preserve: nullable(obj({ selectedSubject: str(300, { trim: false }), body: longText })),
});

export const draftEdits = obj({ selectedSubject: str(300, { min: 1 }), body: str(20000, { min: 1, trim: false }) });

