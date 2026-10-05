// Mail generation context. Two inputs are kept strictly apart:
//   companyEvidence  (kind 'company_evidence'): what KITE observed about THIS company in Phase 4
//                    research. The only source for company-specific statements.
//   sectorGuidance   (kind 'sector_guidance'):  what businesses of this TYPE commonly use the
//                    service for. Never phrased as a fact about the company.
// The server builds this from a request (browser data is re-validated) so the browser cannot
// inject sector guidance or upgrade evidence. Personalization is decided here, by code.
import type { ConfidenceLevel, EvidenceSourceType, VerificationStatus } from '../research';
import { isInspectedEvidence } from '../research';
import { classifySector } from '../sectorTaxonomy';
import { sectorGuidanceFor, type SectorGuidance } from '../sectorIntelligence';
import { SERVICES, type ServiceKey } from '../services';
import { formatLocation } from '../locations';
import type { MailLanguage, Personalization } from './draft';
import { OBSERVATION_TEMPLATES, inspectedSentence, searchSentence } from './observations';
import { serviceGuidance, type ServiceGuidance } from './serviceGuidance';

// ---------- Wire format (browser → server) ----------

export interface MailEvidenceInput {
  id: string;
  url: string;
  title: string;
  sourceType: EvidenceSourceType;
  claim: string;
}

export interface MailSignalInput {
  key: string;
  label: string;
  state: 'positive' | 'neutral' | 'negative' | 'unknown';
  reason: string;
  evidenceIds: string[];
  origin: 'check' | 'analysis' | 'not_inspected';
}

/** Phase 4 research for the company, when it was transferred from a real research job. */
export interface MailResearchInput {
  jobId: string | null;
  overallScore: number | null;
  /** Selected service's score and analysis confidence. */
  serviceScore: number | null;
  analysisConfidence: ConfidenceLevel | null;
  verificationStatus: VerificationStatus | null;
  verificationConfidence: ConfidenceLevel | null;
  websiteInspected: boolean;
  evidence: MailEvidenceInput[];
  /** Selected service's signals. */
  signals: MailSignalInput[];
  inspectedPages: { url: string; title: string; kind: string }[];
}

export interface MailGenerateRequest {
  company: {
    id: string;
    name: string;
    website: string | null;
    sector: string;
    sectorId: string | null;
    city: string;
    country: string;
    /** Phase 2 score, shown for context only; never evidence. */
    opportunityScore: number | null;
  };
  contactName: string | null;
  service: ServiceKey;
  language: MailLanguage;
  research: MailResearchInput | null;
}

// ---------- Context ----------

export interface CompanyEvidenceItem extends MailEvidenceInput {
  /** True only for pages KITE fetched and inspected. */
  inspected: boolean;
}

export interface CompanyObservation {
  /** Signal key, e.g. "booking_flow". */
  id: string;
  evidenceIds: string[];
  /** inspected: seen on a page KITE fetched · search: only reported by search sources. */
  strength: 'inspected' | 'search';
  /** Ready-to-use sentence in the mail language, worded for its strength. */
  sentence: string;
}

export interface MailContext {
  company: { name: string; website: string | null; location: string; country: string; greetingName: string | null };
  sector: { label: string; sectorId: string | null; familyId: string | null; familyLabel: string | null; kind: 'known' | 'family' | 'custom' };
  service: ServiceKey;
  serviceLabel: string;
  language: MailLanguage;
  research: {
    available: boolean;
    jobId: string | null;
    overallScore: number | null;
    serviceScore: number | null;
    analysisConfidence: ConfidenceLevel | null;
    verificationStatus: VerificationStatus | null;
    verificationConfidence: ConfidenceLevel | null;
    websiteInspected: boolean;
  };
  companyEvidence: {
    kind: 'company_evidence';
    items: CompanyEvidenceItem[];
    /** Strongest first. At most 2 (1 when cautious, 0 when general). */
    observations: CompanyObservation[];
    /** Evidence-backed signals (positive or negative) for the model, Turkish reasons. */
    signals: { key: string; label: string; state: 'positive' | 'negative'; reason: string; evidenceIds: string[] }[];
  };
  sectorGuidance: SectorGuidance | null;
  serviceGuidance: ServiceGuidance;
  personalization: Personalization;
  personalizationReasons: string[];
}

const MAX_EVIDENCE = 12;

/**
 * specific: verified or partially verified research with an inspected website and at least medium
 *           confidence, plus usable evidence.
 * cautious: research exists but the website was not inspected, verification is weak or confidence
 *           is low. At most one observation, worded for its evidence strength.
 * general:  no research or no usable evidence. No company-specific observation at all.
 */
export function decidePersonalization(
  research: MailContext['research'],
  usable: { evidence: number; observations: number },
): { level: Personalization; reasons: string[] } {
  if (!research.available) return { level: 'general', reasons: ['Bu şirket için KITE araştırması yok; taslak şirkete özel bir gözlem içermez.'] };
  if (usable.evidence === 0 && usable.observations === 0) {
    return { level: 'general', reasons: ['Araştırmada kullanılabilir şirket kanıtı yok; taslak genel tutuldu.'] };
  }
  const reasons: string[] = [];
  if (!research.websiteInspected) reasons.push('Resmi website incelenemedi; şirkete özel ifadeler temkinli.');
  if (research.verificationStatus === 'unverified') reasons.push('Şirket doğrulanamadı; şirkete özel ifadeler temkinli.');
  if (research.analysisConfidence === 'low') reasons.push('Analiz güveni düşük; ifadeler daha az iddialı.');
  if (research.verificationConfidence === 'low' && research.verificationStatus !== 'unverified') reasons.push('Doğrulama güveni düşük; ifadeler daha az iddialı.');
  if (reasons.length) return { level: 'cautious', reasons };
  return { level: 'specific', reasons: ['Doğrulanmış araştırma ve incelenen website kanıtı var.'] };
}

export function buildMailContext(req: MailGenerateRequest): MailContext {
  const sector = classifySector(req.company.sector, req.company.sectorId);
  const r = req.research;
  const research: MailContext['research'] = {
    available: r !== null,
    jobId: r?.jobId ?? null,
    overallScore: r?.overallScore ?? req.company.opportunityScore,
    serviceScore: r?.serviceScore ?? null,
    analysisConfidence: r?.analysisConfidence ?? null,
    verificationStatus: r?.verificationStatus ?? null,
    verificationConfidence: r?.verificationConfidence ?? null,
    websiteInspected: r?.websiteInspected ?? false,
  };

  // Inspected status is re-derived: an "official" page only counts when the research says the
  // website was inspected (Phase 4.2 provenance rules).
  const items: CompanyEvidenceItem[] = (r?.evidence ?? []).slice(0, MAX_EVIDENCE).map((e) => ({
    ...e,
    inspected: research.websiteInspected && isInspectedEvidence(e),
  }));
  const byId = new Map(items.map((e) => [e.id, e]));
  const homeId = items.find((e) => e.inspected && e.sourceType === 'official_website')?.id ?? items.find((e) => e.inspected)?.id;

  // Signals backed by evidence that exists in this request. Code-measured checks are tied to the
  // inspected homepage; without an inspected page they carry no evidence.
  const backed = (r?.signals ?? [])
    .filter((s) => s.state === 'positive' || s.state === 'negative')
    .map((s) => ({
      ...s,
      evidenceIds: s.origin === 'check' ? (research.websiteInspected && homeId ? [homeId] : []) : s.evidenceIds.filter((id) => byId.has(id)),
    }))
    .filter((s) => s.evidenceIds.length > 0) as (MailSignalInput & { state: 'positive' | 'negative' })[];

  const candidates: CompanyObservation[] = backed
    .filter((s) => s.state === 'positive' && OBSERVATION_TEMPLATES[s.key])
    .map((s) => {
      const strength: CompanyObservation['strength'] = s.evidenceIds.some((id) => byId.get(id)?.inspected) ? 'inspected' : 'search';
      const t = OBSERVATION_TEMPLATES[s.key];
      return { id: s.key, evidenceIds: s.evidenceIds, strength, sentence: strength === 'inspected' ? inspectedSentence(t, req.language) : searchSentence(t, req.language) };
    })
    .filter((o, i, a) => a.findIndex((x) => x.sentence === o.sentence) === i)
    .sort((a, b) => Number(b.strength === 'inspected') - Number(a.strength === 'inspected'));

  const { level, reasons } = decidePersonalization(research, { evidence: items.length, observations: candidates.length });
  // Weak verification: never present a fact as seen on the website.
  const weak = research.verificationStatus === 'unverified';
  const observations =
    level === 'general'
      ? []
      : level === 'cautious'
        ? candidates.slice(0, 1).map((o) => (weak && o.strength === 'inspected' ? { ...o, strength: 'search' as const, sentence: searchSentence(OBSERVATION_TEMPLATES[o.id], req.language) } : o))
        : candidates.slice(0, 2);

  return {
    company: {
      name: req.company.name,
      website: req.company.website,
      location: formatLocation(req.company.city, req.company.country),
      country: req.company.country,
      greetingName: req.contactName?.trim() || null,
    },
    sector: { label: sector.label, sectorId: sector.definition?.id ?? null, familyId: sector.familyId, familyLabel: sector.familyLabel, kind: sector.kind },
    service: req.service,
    serviceLabel: SERVICES[req.service].label,
    language: req.language,
    research,
    companyEvidence: {
      kind: 'company_evidence',
      items: level === 'general' ? [] : items,
      observations,
      signals: level === 'general' ? [] : backed.map(({ key, label, state, reason, evidenceIds }) => ({ key, label, state, reason, evidenceIds })),
    },
    sectorGuidance: sectorGuidanceFor(req.service, req.company.sector, req.company.sectorId),
    serviceGuidance: serviceGuidance(req.service),
    personalization: level,
    personalizationReasons: reasons,
  };
}
