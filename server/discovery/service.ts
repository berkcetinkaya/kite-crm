// Prospecting service (Phase 12): the server-owned review layer over Phase 4 research.
//
// Rules enforced here (the browser only mirrors them):
//   - Real (paid) discovery runs are capped per İstanbul day; fixture runs never count.
//   - Review decisions are reversible until conversion; "Uygun Değil" needs a reason.
//   - Duplicates are recomputed live; a hard match blocks conversion, a probable one needs an
//     explicit "Farklı şirket" confirmation. Nothing is merged.
//   - Conversion creates opportunities only for the services sent explicitly for that candidate.
//     Each candidate converts in its own transaction (bulk failures never roll back others) and a
//     converted candidate never creates a second company (idempotent).
//   - Re-research runs one candidate at a time, keeps the latest 3 previous snapshots and never
//     touches reviewer decisions.
import type { Company } from '../../src/domain/company';
import { startOfBusinessDayIso } from '../../src/domain/businessDay';
import { containsSecret } from '../../src/domain/customers';
import {
  candidateDuplicates,
  contactChannels,
  defaultServices,
  emptyReview,
  MAX_RESEARCH_VERSIONS,
  PROSPECTING_ERROR_MESSAGES,
  prospectPriority,
  researchConfidence,
  researchDiff,
  type CandidateContact,
  type CandidateReview,
  type DiscoveryFilters,
  type DiscoveryRunDetails,
  type ProspectingErrorCode,
  type ResearchVersion,
  type BulkAction,
  type CandidateView,
  type ConversionResult,
  type ConversionStatus,
  type DiscoveryJobView,
  type ReviewPatch,
  isFictionalResearch,
} from '../../src/domain/prospecting';
export type { BulkAction, CandidateView, ConversionResult, ConversionStatus, DiscoveryJobView, ReviewPatch } from '../../src/domain/prospecting';
import type { ResearchProviderId, ResearchRequest, ResearchResult } from '../../src/domain/research';
import type { DiscoveredCandidate } from '../../src/domain/researchApi';
import { classifySector, type SectorFamilyId } from '../../src/domain/sectorTaxonomy';
import type { ServiceKey } from '../../src/domain/services';
import { createId } from '../../src/lib/id';
import { buildNewCompany } from '../../src/state/companies/companyCommands';
import { resultPatchFromAnalysis } from '../../src/state/research/realResearchRunner';
import { companyInputForWebResult, defaultCandidateContacts, isTransferable } from '../../src/state/research/transferInput';
import type { Store } from '../db/store';
import { analyzeCandidate } from '../research/analysis';
import type { ResearchProviderAdapter } from '../research/provider';
import type { PageFetcher } from '../web/safeFetch';

const HTTP: Record<ProspectingErrorCode, number> = {
  candidate_not_found: 404,
  candidate_fictional: 409,
  candidate_converted: 409,
  candidate_invalid: 400,
  candidate_reason_required: 400,
  candidate_duplicate: 409,
  candidate_confirmation_required: 409,
  candidate_not_convertible: 409,
  candidate_busy: 409,
  candidate_rejected: 409,
  daily_limit: 429,
  job_not_found: 404,
};

export class ProspectingError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ProspectingErrorCode,
    message?: string,
  ) {
    super(message ?? PROSPECTING_ERROR_MESSAGES[code]);
    this.name = 'ProspectingError';
    this.status = HTTP[code];
  }
}

export interface DiscoveryDeps {
  now?: () => Date;
  provider?: ResearchProviderAdapter | null;
  fetchPage?: PageFetcher | null;
  maxExtraPages?: number;
  maxRealRunsPerDay: number;
  /** Tests on throwaway databases only: allow converting demo / fixture candidates. Never set by the server. */
  allowFictionalConversion?: boolean;
}

const VERSION_KEYS = ['discovery', 'verification', 'evidence', 'analysis', 'serviceOpportunities', 'contactHints', 'technical', 'opportunityScore', 'service', 'reason', 'companySize', 'researchStatus', 'website', 'city', 'rankScore', 'analysisError'] as const;

export function createDiscoveryService(store: Store, deps: DiscoveryDeps) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  let reresearching = false;

  const resultOf = (id: string) => {
    const r = store.research.getResult(id);
    if (!r) throw new ProspectingError('candidate_not_found');
    return r;
  };
  const jobOf = (id: string) => {
    const j = store.research.getJob(id);
    if (!j) throw new ProspectingError('job_not_found');
    return j;
  };
  const reviewOf = (resultId: string) => store.discovery.getReview(resultId) ?? emptyReview(resultId, now());
  const allResults = () => Object.values(store.research.listResultsByJob()).flat();

  function familyFor(r: ResearchResult, review: CandidateReview, job: ResearchRequest, details: DiscoveryRunDetails | null): SectorFamilyId | null {
    return classifySector(review.sector ?? r.sector, review.sector ? review.sectorId : (job.sectorId ?? null)).familyId ?? details?.filters.familyId ?? null;
  }

  function view(r: ResearchResult, ctx: { job: ResearchRequest; details: DiscoveryRunDetails | null; companies: Company[]; results: ResearchResult[] }): CandidateView {
    const review = store.discovery.getReview(r.id) ?? emptyReview(r.id, r.createdAt);
    const familyId = familyFor(r, review, ctx.job, ctx.details);
    const contacts = review.contacts ?? [];
    const duplicates = candidateDuplicates(r, {
      companies: ctx.companies,
      otherResults: ctx.results,
      acks: review.duplicateAcks,
      extraEmails: contacts.map((c) => c.email),
      extraPhones: contacts.map((c) => c.phone),
    });
    const converted = r.transferredCompanyId ? ctx.companies.find((c) => c.id === r.transferredCompanyId) : undefined;
    return {
      result: r,
      review,
      convertedCompanyId: r.transferredCompanyId,
      convertedCompanyName: converted?.name ?? null,
      duplicates,
      confidence: researchConfidence(r),
      priority: prospectPriority(r, { filters: ctx.details?.filters ?? null, familyId }),
      familyId,
      defaultServices: defaultServices(r, familyId),
      defaultContacts: defaultCandidateContacts(r),
      channels: contactChannels(r),
      versionCount: store.discovery.listVersions(r.id).length,
    };
  }

  function candidateView(resultId: string): CandidateView {
    const r = resultOf(resultId);
    return view(r, context(r.researchRequestId));
  }

  function context(jobId: string) {
    const job = jobOf(jobId);
    return { job, details: store.discovery.getDetails(jobId), companies: store.companies.list(), results: allResults() };
  }

  /** Server-decided provenance: a contact is "website"/"search" only if it matches what research found. */
  function normaliseContacts(r: ResearchResult, contacts: CandidateContact[]): CandidateContact[] {
    const found = defaultCandidateContacts(r);
    return contacts.map((c) => {
      const fullName = c.fullName.trim();
      const email = c.email?.trim() || null;
      const phone = c.phone?.trim() || null;
      if (!fullName) throw new ProspectingError('candidate_invalid', 'Her kişinin bir adı olmalı.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProspectingError('candidate_invalid', `E-posta geçersiz: ${email}`);
      const match = found.find((f) => f.fullName === fullName && (f.email ?? null) === email && (f.phone ?? null) === phone);
      return match ? { ...match, role: c.role.trim() } : { fullName, role: c.role.trim(), email, phone, provenance: 'manual' as const, evidenceIds: [] };
    });
  }

  function applyPatch(r: ResearchResult, current: CandidateReview, patch: ReviewPatch, at: string): CandidateReview {
    if (r.transferredCompanyId) throw new ProspectingError('candidate_converted');
    const next: CandidateReview = { ...current, updatedAt: at };
    if (patch.notes !== undefined) next.notes = patch.notes.trim();
    if (patch.rejectReason !== undefined) next.rejectReason = patch.rejectReason?.trim() || null;
    if (patch.sector !== undefined) {
      next.sector = patch.sector?.trim() || null;
      next.sectorId = next.sector ? (patch.sectorId ?? null) : null;
    }
    if (patch.services !== undefined) next.services = patch.services === null ? null : [...new Set(patch.services)];
    if (patch.contacts !== undefined) next.contacts = patch.contacts === null ? null : normaliseContacts(r, patch.contacts);
    if (patch.status !== undefined && patch.status !== current.status) {
      next.status = patch.status;
      next.reviewedAt = patch.status === 'unreviewed' ? current.reviewedAt : at;
    }
    if (next.status === 'not_fit' && !next.rejectReason) throw new ProspectingError('candidate_reason_required');
    const texts = [next.notes, next.rejectReason ?? '', ...(next.contacts ?? []).flatMap((c) => [c.fullName, c.role])];
    if (texts.some(containsSecret)) throw new ProspectingError('candidate_invalid', 'Şifre, API key veya token saklamayın.');
    return next;
  }

  function convertOne(resultId: string, services: ServiceKey[]): ConversionResult {
    const fail = (status: ConversionStatus, code: ProspectingErrorCode, extra: Partial<ConversionResult> = {}): ConversionResult => ({
      resultId,
      status,
      ok: false,
      message: PROSPECTING_ERROR_MESSAGES[code],
      companyId: null,
      companyName: null,
      ...extra,
    });
    try {
      return store.transaction(() => {
        const r = store.research.getResult(resultId);
        if (!r) return fail('not_found', 'candidate_not_found');
        if (r.transferredCompanyId) {
          const existing = store.companies.get(r.transferredCompanyId);
          return { resultId, status: 'already_converted', ok: true, message: PROSPECTING_ERROR_MESSAGES.candidate_converted, companyId: r.transferredCompanyId, companyName: existing?.name ?? null };
        }
        if (r.source !== 'web' || r.researchStatus !== 'analyzed' || !isTransferable(r)) return fail('not_convertible', 'candidate_not_convertible');
        const job = store.research.getJob(r.researchRequestId);
        if (!job) return fail('not_found', 'job_not_found');
        // Phase 14: demo / fixture results are fictional and never enter the real CRM.
        if (!deps.allowFictionalConversion && isFictionalResearch(job, r)) return fail('not_convertible', 'candidate_fictional');
        const review = reviewOf(r.id);
        // A reviewer "Uygun Değil" decision must be changed first (decisions are reversible, never overridden here).
        if (review.status === 'not_fit') return fail('not_convertible', 'candidate_rejected');
        const companies = store.companies.list();
        const dup = candidateDuplicates(r, {
          companies,
          otherResults: allResults(),
          acks: review.duplicateAcks,
          extraEmails: (review.contacts ?? []).map((c) => c.email),
          extraPhones: (review.contacts ?? []).map((c) => c.phone),
        });
        if (dup.blocksConversion) {
          const m = dup.matches.find((x) => x.level === 'hard')!;
          return fail('duplicate', 'candidate_duplicate', { message: `${PROSPECTING_ERROR_MESSAGES.candidate_duplicate} (${m.label})`, companyId: m.companyId, companyName: m.companyName });
        }
        if (dup.needsConfirmation) return fail('confirmation_required', 'candidate_confirmation_required');
        const at = now();
        const chosen = [...new Set(services)];
        const input = companyInputForWebResult(r, job, { services: chosen, contacts: review.contacts, sector: review.sector, note: review.notes });
        const company = buildNewCompany(input, at);
        store.companies.insert(company);
        store.research.saveResults(r.researchRequestId, [{ ...r, selected: false, alreadyInProspects: true, transferredCompanyId: company.id }]);
        store.discovery.saveReview({ ...review, services: chosen, status: 'fit', reviewedAt: review.reviewedAt ?? at, updatedAt: at });
        store.research.saveJob({ ...job, updatedAt: at });
        return { resultId, status: 'converted', ok: true, message: "CRM'e eklendi.", companyId: company.id, companyName: company.name };
      });
    } catch (e) {
      console.error('[discovery] conversion failed:', e instanceof Error ? e.message : e);
      return fail('error', 'candidate_invalid', { message: 'Bu aday eklenirken beklenmeyen bir hata oluştu; diğer adaylar etkilenmedi.' });
    }
  }

  return {
    /** Real (paid) runs started today and the cap; fixture runs are not counted. */
    realRuns: () => ({ today: store.discovery.countRealRunsSince(startOfBusinessDayIso(now())), limit: deps.maxRealRunsPerDay }),

    /** Called by the discovery endpoint before the provider runs. Enforces the daily cap for real providers. */
    beginRun(input: { jobId: string; providerId: ResearchProviderId; filters: DiscoveryFilters; plannedMaxSearches: number; plannedMaxInspections: number }): DiscoveryRunDetails {
      return store.transaction(() => {
        jobOf(input.jobId);
        const at = now();
        const existing = store.discovery.getDetails(input.jobId);
        if (!existing && input.providerId !== 'fixture' && store.discovery.countRealRunsSince(startOfBusinessDayIso(at)) >= deps.maxRealRunsPerDay) throw new ProspectingError('daily_limit');
        const details: DiscoveryRunDetails = {
          jobId: input.jobId,
          provider: input.providerId,
          filters: input.filters,
          searchQueries: existing?.searchQueries ?? [],
          searchesUsed: existing?.searchesUsed ?? 0,
          plannedMaxSearches: input.plannedMaxSearches,
          plannedMaxInspections: input.plannedMaxInspections,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at,
        };
        store.discovery.saveDetails(details);
        return details;
      });
    },

    finishRun(jobId: string, usage: { searchesUsed: number; queries: string[] }) {
      const d = store.discovery.getDetails(jobId);
      if (!d) return;
      store.discovery.saveDetails({ ...d, searchesUsed: d.searchesUsed + usage.searchesUsed, searchQueries: [...d.searchQueries, ...usage.queries].slice(0, 40), updatedAt: now() });
    },

    job(jobId: string): DiscoveryJobView {
      const ctx = context(jobId);
      const candidates = store.research.listResults(jobId).filter((r) => r.source === 'web').map((r) => view(r, ctx));
      const counts = {
        total: candidates.length,
        unreviewed: candidates.filter((c) => !c.convertedCompanyId && c.review.status === 'unreviewed').length,
        fit: candidates.filter((c) => !c.convertedCompanyId && c.review.status === 'fit').length,
        notFit: candidates.filter((c) => !c.convertedCompanyId && c.review.status === 'not_fit').length,
        converted: candidates.filter((c) => !!c.convertedCompanyId).length,
      };
      return { job: ctx.job, details: ctx.details, candidates, counts, reviewed: counts.total > 0 && counts.unreviewed === 0 };
    },

    candidate: (resultId: string): CandidateView => candidateView(resultId),

    updateReview(resultId: string, patch: ReviewPatch): CandidateView {
      store.transaction(() => {
        const r = resultOf(resultId);
        store.discovery.saveReview(applyPatch(r, reviewOf(resultId), patch, now()));
      });
      return candidateView(resultId);
    },

    /** "Farklı şirket" (confirmed = true) or undo (false), only for a current probable match. */
    acknowledgeDuplicate(resultId: string, key: string, confirmed: boolean): CandidateView {
      store.transaction(() => {
        const r = resultOf(resultId);
        if (r.transferredCompanyId) throw new ProspectingError('candidate_converted');
        const current = candidateView(resultId);
        if (confirmed && !current.duplicates.matches.some((m) => m.key === key && m.level === 'probable'))
          throw new ProspectingError('candidate_invalid', 'Bu eşleşme onaylanabilecek bir muhtemel tekrar değil.');
        const acks = new Set(current.review.duplicateAcks);
        if (confirmed) acks.add(key);
        else acks.delete(key);
        store.discovery.saveReview({ ...current.review, duplicateAcks: [...acks], updatedAt: now() });
      });
      return candidateView(resultId);
    },

    /** Safe bulk review: each candidate in its own transaction; converted ones are skipped. */
    bulk(resultIds: string[], action: BulkAction): { resultId: string; ok: boolean; message: string }[] {
      return [...new Set(resultIds)].map((id) => {
        try {
          store.transaction(() => {
            const r = resultOf(id);
            const patch: ReviewPatch =
              action.type === 'status'
                ? { status: action.status, ...(action.rejectReason !== undefined ? { rejectReason: action.rejectReason } : {}) }
                : action.type === 'services'
                  ? { services: action.services }
                  : { sector: action.sector, sectorId: action.sectorId };
            store.discovery.saveReview(applyPatch(r, reviewOf(id), patch, now()));
          });
          return { resultId: id, ok: true, message: 'Güncellendi.' };
        } catch (e) {
          return { resultId: id, ok: false, message: e instanceof ProspectingError ? e.message : 'Güncellenemedi.' };
        }
      });
    },

    /** Converts each candidate in its own transaction with the services sent for it. */
    convert(items: { resultId: string; services: ServiceKey[] }[]): ConversionResult[] {
      const seen = new Set<string>();
      return items.filter((i) => !seen.has(i.resultId) && seen.add(i.resultId)).map((i) => convertOne(i.resultId, i.services));
    },

    versions: (resultId: string): ResearchVersion[] => {
      resultOf(resultId);
      return store.discovery.listVersions(resultId);
    },

    /** Re-runs inspection + analysis for one candidate (explicit action, one at a time). */
    async reresearch(resultId: string, signal?: AbortSignal): Promise<{ candidate: CandidateView; changes: string[] }> {
      if (!deps.provider || !deps.fetchPage) throw new ProspectingError('candidate_invalid', 'Araştırma sağlayıcısı yapılandırılmadığı için yeniden araştırma yapılamaz.');
      const before = resultOf(resultId);
      if (before.transferredCompanyId) throw new ProspectingError('candidate_converted');
      if (before.source !== 'web') throw new ProspectingError('candidate_not_convertible');
      if (reresearching) throw new ProspectingError('candidate_busy');
      reresearching = true;
      try {
        const job = jobOf(before.researchRequestId);
        const candidate: DiscoveredCandidate = {
          id: before.id,
          name: before.companyName,
          website: before.website ?? '',
          city: before.city,
          country: before.country,
          sectorFit: before.discovery?.sectorFit ?? '',
          profileFit: before.discovery?.profileFit ?? 'unknown',
          confidence: before.discovery?.confidence ?? 'low',
          evidence: (before.evidence ?? []).filter((e) => e.sourceType !== 'official_website' && e.sourceType !== 'official_page'),
        };
        const analyzed = await analyzeCandidate({ provider: deps.provider, fetchPage: deps.fetchPage, maxExtraPages: deps.maxExtraPages ?? 3 }, job, candidate, () => {}, signal);
        const patch = resultPatchFromAnalysis(analyzed);
        const changes = store.transaction(() => {
          const current = resultOf(resultId);
          if (current.transferredCompanyId) throw new ProspectingError('candidate_converted');
          const snapshot = Object.fromEntries(VERSION_KEYS.filter((k) => current[k] !== undefined).map((k) => [k, current[k]]));
          store.discovery.addVersion({ id: createId('rver'), resultId, version: 0, snapshot, opportunityScore: current.opportunityScore, createdAt: now() }, MAX_RESEARCH_VERSIONS);
          const next: ResearchResult = { ...current, ...patch, id: current.id, researchRequestId: current.researchRequestId, transferredCompanyId: null, selected: current.selected, createdAt: current.createdAt };
          store.research.saveResults(current.researchRequestId, [next]);
          return researchDiff(current, next);
        });
        return { candidate: candidateView(resultId), changes };
      } finally {
        reresearching = false;
      }
    },
  };
}

export type DiscoveryServiceApi = ReturnType<typeof createDiscoveryService>;
