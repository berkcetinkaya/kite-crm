// Server-side validation of mail generation requests. Everything from the browser is untrusted:
// lengths are bounded, enums checked, URLs re-validated, and unknown signal keys dropped.
import type { MailEvidenceInput, MailGenerateRequest, MailResearchInput, MailSignalInput } from '../../src/domain/mail/context';
import { SERVICE_KEYS, type ServiceKey } from '../../src/domain/services';
import { SERVICE_SIGNALS } from '../../src/domain/opportunityAnalysis';
import { getSectorDefinition } from '../../src/domain/sectorTaxonomy';
import { RequestValidationError } from '../research/validateRequest';
import { assertPublicHttpUrl } from '../web/urlSafety';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, field: string, max: number, required = false): string {
  if (v === undefined || v === null) {
    if (required) throw new RequestValidationError(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') throw new RequestValidationError(`${field} must be a string`);
  const s = v.trim();
  if (required && !s) throw new RequestValidationError(`${field} is required`);
  return s.slice(0, max);
}

const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null => (values as readonly unknown[]).includes(v) ? (v as T) : null;

function score(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : null;
}

const SOURCE_TYPES = ['official_website', 'official_page', 'official_page_unfetched', 'search_result', 'directory', 'publication', 'other'] as const;
const LEVELS = ['high', 'medium', 'low'] as const;

function evidence(v: unknown): MailEvidenceInput[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).flatMap((e) => {
    if (!isObj(e) || typeof e.url !== 'string') return [];
    try {
      assertPublicHttpUrl(e.url);
    } catch {
      return [];
    }
    const id = text(e.id, 'evidence.id', 10, true);
    return [{ id, url: e.url.slice(0, 500), title: text(e.title, 'evidence.title', 200), sourceType: oneOf(e.sourceType, SOURCE_TYPES) ?? 'other', claim: text(e.claim, 'evidence.claim', 300) }];
  });
}

function signals(v: unknown, service: ServiceKey): MailSignalInput[] {
  if (!Array.isArray(v)) return [];
  const known = new Set(SERVICE_SIGNALS[service].map((s) => s.key));
  return v.slice(0, 30).flatMap((s) => {
    if (!isObj(s) || typeof s.key !== 'string' || !known.has(s.key)) return [];
    return [{
      key: s.key,
      label: text(s.label, 'signal.label', 80),
      state: oneOf(s.state, ['positive', 'neutral', 'negative', 'unknown'] as const) ?? 'unknown',
      reason: text(s.reason, 'signal.reason', 300),
      evidenceIds: Array.isArray(s.evidenceIds) ? s.evidenceIds.filter((x): x is string => typeof x === 'string').slice(0, 10) : [],
      origin: oneOf(s.origin, ['check', 'analysis', 'not_inspected'] as const) ?? 'analysis',
    }];
  });
}

function research(v: unknown, service: ServiceKey): MailResearchInput | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) throw new RequestValidationError('research must be an object');
  return {
    jobId: text(v.jobId, 'research.jobId', 80) || null,
    overallScore: score(v.overallScore),
    serviceScore: score(v.serviceScore),
    analysisConfidence: oneOf(v.analysisConfidence, LEVELS),
    verificationStatus: oneOf(v.verificationStatus, ['verified', 'partial', 'unverified'] as const),
    verificationConfidence: oneOf(v.verificationConfidence, LEVELS),
    websiteInspected: v.websiteInspected === true,
    evidence: evidence(v.evidence),
    signals: signals(v.signals, service),
    inspectedPages: Array.isArray(v.inspectedPages)
      ? v.inspectedPages.slice(0, 6).filter(isObj).map((p) => ({ url: text(p.url, 'page.url', 500), title: text(p.title, 'page.title', 200), kind: text(p.kind, 'page.kind', 20) }))
      : [],
  };
}

export function validateMailRequest(body: unknown): MailGenerateRequest {
  if (!isObj(body) || !isObj(body.company)) throw new RequestValidationError('company is required');
  const c = body.company;
  const service = oneOf(body.service, SERVICE_KEYS);
  if (!service) throw new RequestValidationError('invalid service');
  const language = oneOf(body.language, ['tr', 'en'] as const);
  if (!language) throw new RequestValidationError('invalid language');
  let website: string | null = null;
  if (typeof c.website === 'string' && c.website.trim()) {
    try {
      website = assertPublicHttpUrl(/^https?:\/\//i.test(c.website) ? c.website : `https://${c.website}`).toString();
    } catch {
      website = null;
    }
  }
  const sectorId = typeof c.sectorId === 'string' && getSectorDefinition(c.sectorId) ? c.sectorId : null;
  return {
    company: {
      id: text(c.id, 'company.id', 80, true),
      name: text(c.name, 'company.name', 120, true),
      website,
      sector: text(c.sector, 'company.sector', 120, true),
      sectorId,
      city: text(c.city, 'company.city', 80),
      country: text(c.country, 'company.country', 80, true),
      opportunityScore: score(c.opportunityScore),
    },
    contactName: text(body.contactName, 'contactName', 80) || null,
    service,
    language,
    research: research(body.research, service),
  };
}
