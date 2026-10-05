// Pure builders that turn research results into Phase 2 company input. Shared by the browser and
// the persistence server (which performs the actual transfer in one transaction).
import { CURRENT_USER, type PotentialLevel, type ServiceOpportunity } from '../../domain/company';
import { RECOMMEND_MIN_SCORE } from '../../domain/opportunityAnalysis';
import { isInspectedEvidence, type ResearchRequest, type ResearchResult } from '../../domain/research';
import { scoreBand } from '../../domain/score';
import { canonicalCountryName, researchResultCountry } from '../../domain/locations';
import type { ContactInput, NewCompanyInput } from '../companies/companyCommands';

const POTENTIAL_FOR_BAND: Record<ReturnType<typeof scoreBand>, PotentialLevel> = { strong: 'high', medium: 'medium', weak: 'low' };

/** Results that can be selected and transferred: demo rows and analyzed real companies. */
export function isTransferable(r: ResearchResult): boolean {
  return r.researchStatus === 'demo' || r.researchStatus === 'analyzed';
}

/** Builds the Phase 2 company input for a real (web) result. */
export function companyInputForWebResult(r: ResearchResult, request: ResearchRequest): NewCompanyInput {
  const recommended = (r.serviceOpportunities ?? []).filter((o, i) => i === 0 || o.score >= RECOMMEND_MIN_SCORE);
  const opportunities: ServiceOpportunity[] = recommended.map((o) => ({
    service: o.service,
    score: o.score,
    reason: o.reason,
    potential: POTENTIAL_FOR_BAND[scoreBand(o.score)],
  }));
  const hints = r.contactHints ?? [];
  const contacts: ContactInput[] = hints
    .filter((h) => h.kind === 'person')
    .map((h) => ({
      fullName: h.value,
      role: h.role ?? '',
      email: null,
      phone: null,
      linkedin: null,
      isDecisionMaker: false,
      confidence: h.confidence,
    }));
  const email = hints.find((h) => h.kind === 'email')?.value ?? null;
  const phone = hints.find((h) => h.kind === 'phone')?.value ?? null;
  if (email || phone) {
    contacts.push({
      fullName: 'Genel iletişim',
      role: 'Websitede yayınlanan şirket iletişimi',
      email,
      phone,
      linkedin: null,
      isDecisionMaker: false,
      confidence: 'high',
    });
  }
  const evidence = r.evidence ?? [];
  // Inspected official pages first, then search evidence; one entry per URL.
  const sources = [...evidence.filter(isInspectedEvidence), ...evidence.filter((e) => !isInspectedEvidence(e))]
    .filter((e, i, a) => a.findIndex((x) => x.url === e.url) === i)
    .slice(0, 5)
    .map((e) => ({ url: e.url, title: e.title, sourceType: e.sourceType }));
  const sourceUrls = sources.map((s) => s.url);
  const isFixture = request.provider === 'fixture';
  return {
    name: r.companyName,
    website: r.website,
    sector: r.sector,
    city: r.city ?? '',
    // Canonical name from the job's criteria (also fixes results stored before normalisation, e.g. "AE").
    country: researchResultCountry(request),
    source: 'research',
    opportunities,
    opportunityScore: r.opportunityScore,
    status: 'found',
    owner: CURRENT_USER,
    note: '',
    companySize: r.companySize,
    contacts,
    createdMessage: isFixture ? 'Şirket test araştırması (fixture) ile sisteme eklendi' : 'Şirket gerçek araştırma ile sisteme eklendi',
    origin: `Araştırma: ${request.name}`,
    researchRef: { requestId: request.id, requestName: request.name, mode: 'real', researchedAt: r.createdAt, sourceUrls, sources },
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

