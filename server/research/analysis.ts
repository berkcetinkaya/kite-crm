// Per-company pipeline: inspect website → build evidence → provider classifies signals → code
// validates, verifies and scores. The provider never produces a number shown to the user.
import type { AnalyzeEvent, AnalyzedCompany, DiscoveredCandidate } from '../../src/domain/researchApi';
import { RESEARCH_ERROR_MESSAGES } from '../../src/domain/researchApi';
import type {
  ContactHint,
  ResearchCriteria,
  ResearchEvidence,
} from '../../src/domain/research';
import {
  analyzeServices,
  modelClassifiedSignals,
  overallScore,
  verificationStatus,
  type SignalClassification,
} from '../../src/domain/opportunityAnalysis';
import { SERVICE_KEYS, type ServiceKey } from '../../src/domain/services';
import { inspectWebsite } from '../web/inspect';
import type { PageFetcher } from '../web/safeFetch';
import { ProviderError, type ResearchProviderAdapter, type SignalToClassify } from './provider';
import { parseAnalysis, type ParsedAnalysis } from './schemas';

const PAGE_KIND_LABELS: Record<string, string> = {
  home: 'Ana sayfa',
  contact: 'İletişim sayfası',
  services: 'Hizmet / ürün sayfası',
  booking: 'Rezervasyon / randevu sayfası',
  about: 'Hakkımızda sayfası',
  pricing: 'Fiyat / paket sayfası',
};

function signalsToClassify(): SignalToClassify[] {
  return SERVICE_KEYS.flatMap((service) =>
    modelClassifiedSignals(service).map((d) => ({ service, key: d.key, label: d.label, guide: d.guide ?? '' })),
  );
}

/**
 * Turns validated model classifications into per-service maps. A positive/negative/neutral state
 * without any cited evidence is downgraded to unknown: no evidence, no claim.
 */
function classificationsByService(parsed: ParsedAnalysis): Partial<Record<ServiceKey, Record<string, SignalClassification>>> {
  const allowed = new Set(signalsToClassify().map((s) => `${s.service}.${s.key}`));
  const out: Partial<Record<ServiceKey, Record<string, SignalClassification>>> = {};
  for (const s of parsed.signals) {
    if (!allowed.has(`${s.service}.${s.key}`)) continue;
    const backed = s.state === 'unknown' || s.evidenceIds.length > 0;
    (out[s.service] ??= {})[s.key] = backed
      ? { state: s.state, reason: s.reason || 'Gerekçe belirtilmedi.', evidenceIds: s.evidenceIds }
      : { state: 'unknown', reason: 'Kanıt gösterilmediği için bilinmiyor olarak işaretlendi.', evidenceIds: [] };
  }
  return out;
}

export interface AnalyzeDeps {
  provider: ResearchProviderAdapter;
  fetchPage: PageFetcher;
  maxExtraPages: number;
  now?: () => Date;
}

export async function analyzeCandidate(
  deps: AnalyzeDeps,
  criteria: ResearchCriteria,
  candidate: DiscoveredCandidate,
  emit: (e: AnalyzeEvent) => void,
  signal?: AbortSignal,
): Promise<AnalyzedCompany> {
  const retrievedAt = (deps.now?.() ?? new Date()).toISOString();
  const inspection = await inspectWebsite(candidate.website, deps.fetchPage, { maxExtraPages: deps.maxExtraPages, signal });
  emit({ type: 'inspected', candidateId: candidate.id, websiteOk: inspection.ok });

  // Evidence: discovery sources (d*) + inspected official pages (w*).
  const pageEvidence: ResearchEvidence[] = inspection.pages.map((p, i) => ({
    id: `w${i + 1}`,
    url: p.url,
    title: p.title || p.url,
    sourceType: p.kind === 'home' ? 'official_website' : 'official_page',
    claim: `${PAGE_KIND_LABELS[p.kind] ?? 'Sayfa'} incelendi${p.metaDescription ? `: ${p.metaDescription.slice(0, 160)}` : '.'}`,
    retrievedAt,
  }));
  const evidence = [...candidate.evidence, ...pageEvidence];
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const isOfficial = (id: string) => {
    const t = evidenceById.get(id)?.sourceType;
    return t === 'official_website' || t === 'official_page';
  };

  const raw = await deps.provider.analyzeCompany({
    criteria,
    candidate,
    evidence,
    pages: inspection.pages,
    technical: inspection.technical,
    signals: signalsToClassify(),
    signal,
  });
  const parsed = parseAnalysis(raw, new Set(evidence.map((e) => e.id)));

  // ---- verification (code decides; model claims need evidence) ----
  const officialWebsiteVerified =
    inspection.ok && parsed.websiteMatchesCompany && parsed.websiteMatchEvidenceIds.some(isOfficial);
  const locationVerified = parsed.locationVerified && parsed.locationEvidenceIds.length > 0;
  const sectorVerified = parsed.sectorVerified && parsed.sectorEvidenceIds.length > 0;
  const { status, confidence } = verificationStatus({ officialWebsiteVerified, locationVerified, sectorVerified });
  const place = criteria.city ? `${criteria.city}, ${criteria.country}` : criteria.country;
  const verified: string[] = [];
  const unverified: string[] = [];
  (officialWebsiteVerified ? verified : unverified).push(
    officialWebsiteVerified ? 'Resmi website incelendi ve şirkete ait olduğu doğrulandı.' : inspection.ok ? 'Websitenin bu şirkete ait olduğu doğrulanamadı.' : 'Resmi website incelenemedi.',
  );
  (locationVerified ? verified : unverified).push(
    locationVerified ? `Şirketin ${place} pazarında faaliyet gösterdiği kaynaklarla destekleniyor.` : `${place} pazarında faaliyet gösterdiği doğrulanamadı.`,
  );
  (sectorVerified ? verified : unverified).push(
    sectorVerified ? `Sektör uyumu (${criteria.sector}) kaynaklarla destekleniyor.` : `Sektör uyumu (${criteria.sector}) doğrulanamadı.`,
  );

  // ---- opportunities (deterministic scoring) ----
  const reasons = Object.fromEntries(parsed.serviceReasons.map((r) => [r.service, r.reason])) as Partial<Record<ServiceKey, string>>;
  const serviceOpportunities = analyzeServices(inspection.technical, classificationsByService(parsed), reasons);

  // ---- public contact hints: only values found on the official pages ----
  const contactHints: ContactHint[] = [];
  inspection.pages.forEach((p, i) => {
    const ev = [`w${i + 1}`];
    for (const email of p.emails.slice(0, 2)) contactHints.push({ kind: 'email', value: email, role: null, evidenceIds: ev, confidence: 'high' });
    for (const phone of p.phones.slice(0, 2)) contactHints.push({ kind: 'phone', value: phone, role: null, evidenceIds: ev, confidence: 'high' });
    for (const wa of p.whatsappLinks.slice(0, 1)) contactHints.push({ kind: 'whatsapp', value: wa, role: null, evidenceIds: ev, confidence: 'high' });
    if (p.kind === 'contact') contactHints.push({ kind: 'contact_page', value: p.url, role: null, evidenceIds: ev, confidence: 'high' });
  });
  for (const person of parsed.people) {
    const officialIds = person.evidenceIds.filter(isOfficial);
    if (officialIds.length === 0) continue; // publicly named on the company's own site only
    contactHints.push({ kind: 'person', value: person.name, role: person.role || null, evidenceIds: officialIds, confidence: 'medium' });
  }
  const dedupedHints = contactHints.filter(
    (h, i) => contactHints.findIndex((x) => x.kind === h.kind && x.value === h.value) === i,
  );

  const excluded = parsed.exclusionChecks.some((e) => e.status === 'violated' && e.evidenceIds.length > 0);
  const warnings: string[] = [];
  if (!inspection.ok) warnings.push(RESEARCH_ERROR_MESSAGES.website_unreachable);
  if (excluded) warnings.push('Hariç tutma kriterlerinden biriyle eşleştiği için seçilemez.');

  return {
    candidateId: candidate.id,
    companyName: candidate.name,
    website: inspection.technical.finalUrl ? new URL(inspection.technical.finalUrl).origin + '/' : candidate.website,
    sector: criteria.sector,
    city: candidate.city ?? parsed.observedCity ?? criteria.city,
    country: candidate.country || criteria.country,
    companySize: parsed.companySizeEvidenceIds.length ? parsed.companySize : null,
    verification: {
      status,
      confidence,
      officialWebsiteVerified,
      locationVerified,
      sectorVerified,
      verified,
      unverified,
      evidenceIds: [...new Set([...parsed.websiteMatchEvidenceIds, ...parsed.locationEvidenceIds, ...parsed.sectorEvidenceIds])],
    },
    evidence,
    analysis: {
      summary: parsed.summary,
      criteriaMatch: parsed.criteriaMatch,
      criteriaNotes: parsed.criteriaNotes,
      exclusionChecks: parsed.exclusionChecks,
      websiteInspected: inspection.ok,
      warnings,
    },
    serviceOpportunities,
    overallScore: overallScore(serviceOpportunities),
    contactHints: dedupedHints,
    technical: inspection.technical,
    excluded,
  };
}

/** Runs a batch concurrently; each company reports independently so partial results survive. */
export async function analyzeBatch(
  deps: AnalyzeDeps,
  criteria: ResearchCriteria,
  candidates: DiscoveredCandidate[],
  emit: (e: AnalyzeEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const result = await analyzeCandidate(deps, criteria, candidate, emit, signal);
        emit({ type: 'analyzed', candidateId: candidate.id, result });
      } catch (e) {
        if (signal?.aborted) return;
        const code = e instanceof ProviderError ? e.code : 'internal';
        if (!(e instanceof ProviderError)) console.error('[research] analysis failed:', e);
        else console.warn(`[research] analysis failed for ${candidate.name}: ${e.code} ${e.message}`);
        emit({ type: 'failed', candidateId: candidate.id, code, message: RESEARCH_ERROR_MESSAGES[code] });
      }
    }),
  );
}

