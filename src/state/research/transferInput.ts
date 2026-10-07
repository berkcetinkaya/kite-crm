// Pure builders that turn research results into Phase 2 company input. Shared by the browser and
// the persistence server (which performs the actual transfer in one transaction).
import { CURRENT_USER, GENERAL_CONTACT_NAME, type PotentialLevel, type ServiceOpportunity } from '../../domain/company';
import { isInspectedEvidence, type ResearchRequest, type ResearchResult } from '../../domain/research';
import { scoreBand } from '../../domain/score';
import { canonicalCountryName, researchResultCountry } from '../../domain/locations';
import type { ContactInput, NewCompanyInput } from '../companies/companyCommands';
import type { CandidateContact } from '../../domain/prospecting';
import type { ServiceKey } from '../../domain/services';

const POTENTIAL_FOR_BAND: Record<ReturnType<typeof scoreBand>, PotentialLevel> = { strong: 'high', medium: 'medium', weak: 'low' };

/** Results that can be selected and transferred: demo rows and analyzed real companies. */
export function isTransferable(r: ResearchResult): boolean {
  return r.researchStatus === 'demo' || r.researchStatus === 'analyzed';
}

/** Reviewer decisions applied on conversion (Phase 12). */
export interface ConversionOverrides {
  /** Explicitly selected services, primary first. Only these become opportunities. */
  services?: ServiceKey[];
  /** Reviewer's final contacts (null/undefined = default from the research contact hints). */
  contacts?: CandidateContact[] | null;
  /** Reviewer's sector (null/undefined = keep the research sector). */
  sector?: string | null;
  /** Reviewer notes, carried as the company's first note. */
  note?: string;
}

const CONFIDENCE_FOR_PROVENANCE: Record<CandidateContact['provenance'], ContactInput['confidence']> = { website: 'high', search_result: 'medium', manual: 'medium' };

/**
 * Default contacts from the research: people named on the company's own pages (no guessed email) and
 * the published email / phone as the general contact. Nothing is invented.
 */
export function defaultCandidateContacts(r: ResearchResult): CandidateContact[] {
  const hints = r.contactHints ?? [];
  const evidence = r.evidence ?? [];
  const provenance = (ids: string[]): CandidateContact['provenance'] =>
    ids.some((id) => evidence.some((e) => e.id === id && isInspectedEvidence(e))) ? 'website' : 'search_result';
  const out: CandidateContact[] = hints
    .filter((h) => h.kind === 'person')
    .map((h) => ({ fullName: h.value, role: h.role ?? '', email: null, phone: null, provenance: provenance(h.evidenceIds), evidenceIds: h.evidenceIds }));
  const email = hints.find((h) => h.kind === 'email');
  const phone = hints.find((h) => h.kind === 'phone');
  if (email || phone) {
    out.push({
      fullName: GENERAL_CONTACT_NAME,
      role: 'Websitede yayınlanan şirket iletişimi',
      email: email?.value ?? null,
      phone: phone?.value ?? null,
      provenance: provenance([...(email?.evidenceIds ?? []), ...(phone?.evidenceIds ?? [])]),
      evidenceIds: [...(email?.evidenceIds ?? []), ...(phone?.evidenceIds ?? [])],
    });
  }
  return out;
}

/**
 * Builds the Phase 2 company input for a real (web) result. Opportunities come only from the
 * explicitly selected services (Phase 12); without a selection only the primary service is used.
 */
export function companyInputForWebResult(r: ResearchResult, request: ResearchRequest, overrides: ConversionOverrides = {}): NewCompanyInput {
  const analysisFor = (service: ServiceKey) => (r.serviceOpportunities ?? []).find((o) => o.service === service);
  const services = overrides.services ?? [r.serviceOpportunities?.[0]?.service ?? r.service];
  const opportunities: ServiceOpportunity[] = [...new Set(services)].map((service) => {
    const o = analysisFor(service);
    return o
      ? { service, score: o.score, reason: o.reason, potential: POTENTIAL_FOR_BAND[scoreBand(o.score)] }
      : { service, score: null, reason: 'İnceleme sırasında seçildi.', potential: null };
  });
  const contacts: ContactInput[] = (overrides.contacts ?? defaultCandidateContacts(r)).map((c) => ({
    fullName: c.fullName,
    role: c.role,
    email: c.email,
    phone: c.phone,
    linkedin: null,
    isDecisionMaker: false,
    confidence: CONFIDENCE_FOR_PROVENANCE[c.provenance],
  }));
  const evidence = r.evidence ?? [];
  // Inspected official pages first, then search evidence; one entry per URL.
  const sources = [...evidence.filter(isInspectedEvidence), ...evidence.filter((e) => !isInspectedEvidence(e))]
    .filter((e, i, a) => a.findIndex((x) => x.url === e.url) === i)
    .slice(0, 5)
    .map((e) => ({ url: e.url, title: e.title, sourceType: e.sourceType }));
  const sourceUrls = sources.map((s) => s.url);
  // Social profiles linked from the company's own website (never scraped).
  const socials = (r.technical?.socialLinks ?? []).slice(0, 3).map((url) => ({ url, title: 'Sosyal medya profili (websitede bağlantı)', sourceType: 'other' as const }));
  const isFixture = request.provider === 'fixture';
  return {
    name: r.companyName,
    website: r.website,
    sector: overrides.sector?.trim() || r.sector,
    city: r.city ?? '',
    // Canonical name from the job's criteria (also fixes results stored before normalisation, e.g. "AE").
    country: researchResultCountry(request),
    source: 'research',
    opportunities,
    opportunityScore: r.opportunityScore,
    status: 'found',
    owner: CURRENT_USER,
    note: overrides.note?.trim() ?? '',
    companySize: r.companySize,
    contacts,
    createdMessage: isFixture ? 'Şirket test araştırması (fixture) ile sisteme eklendi' : 'Şirket gerçek araştırma ile sisteme eklendi',
    origin: `Araştırma: ${request.name}`,
    researchRef: { requestId: request.id, requestName: request.name, mode: 'real', researchedAt: r.createdAt, sourceUrls, sources: [...sources, ...socials] },
  };
}

export function companyInputForDemoResult(r: ResearchResult, request: ResearchRequest): NewCompanyInput {
  return {
    name: r.companyName,
    website: r.website,
    sector: r.sector,
    city: r.city ?? '',
    country: canonicalCountryName(r.country),
    source: 'research',
    opportunities: [{ service: r.service, score: r.opportunityScore, reason: r.reason, potential: null }],
    opportunityScore: r.opportunityScore,
    status: 'found',
    owner: CURRENT_USER,
    note: '',
    companySize: r.companySize,
    origin: `Araştırma: ${request.name} (demo)`,
    researchRef: { requestId: request.id, requestName: request.name, mode: 'demo', researchedAt: r.createdAt, sourceUrls: [] },
  };
}

