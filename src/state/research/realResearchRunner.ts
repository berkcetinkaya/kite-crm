// Orchestrates one real research job from the browser: discover → analyze in small batches.
// Progress counters only change when the server reports completed work (no timers). Kept free of
// React so it can be tested with a fake API.
import type { ResearchApi } from '../../api/researchApi';
import { ResearchApiError } from '../../api/researchApi';
import type { Company } from '../../domain/company';
import { rankScoreFor } from '../../domain/opportunityAnalysis';
import {
  findProspectMatch,
  type RealResearchProgress,
  type ResearchCriteria,
  type ResearchRequest,
  type ResearchResult,
} from '../../domain/research';
import {
  REAL_RESEARCH_LIMITS,
  RESEARCH_ERROR_MESSAGES,
  type AnalyzedCompany,
  type DiscoveredCandidate,
  type ResearchErrorCode,
} from '../../domain/researchApi';
import { websiteHost } from '../../lib/url';
import { canonicalCountryName, researchResultCountry } from '../../domain/locations';

export interface RunnerCallbacks {
  patchRequest: (patch: Partial<ResearchRequest>) => void;
  addResults: (results: ResearchResult[]) => void;
  patchResult: (resultId: string, patch: Partial<ResearchResult>) => void;
}

export interface RunnerContext {
  api: ResearchApi;
  requestId: string;
  criteria: ResearchCriteria;
  companies: readonly Company[];
  signal: AbortSignal;
  makeId: () => string;
  now?: () => Date;
}

/** Errors after which further batches would fail the same way. */
const FATAL: ResearchErrorCode[] = ['not_configured', 'auth', 'server_unreachable', 'cancelled'];

const nowIso = (ctx: Pick<RunnerContext, 'now'>) => (ctx.now?.() ?? new Date()).toISOString();

/** Converts a server analysis into result fields. The primary service is the top-scoring one. */
export function resultPatchFromAnalysis(a: AnalyzedCompany): Partial<ResearchResult> {
  const primary = a.serviceOpportunities[0];
  const patch: Partial<ResearchResult> = {
    researchStatus: a.excluded ? 'excluded' : 'analyzed',
    companyName: a.companyName,
    website: a.website,
    city: a.city,
    country: canonicalCountryName(a.country),
    companySize: a.companySize,
    service: primary.service,
    opportunityScore: a.overallScore,
    reason: primary.reason,
    verification: a.verification,
    evidence: a.evidence,
    analysis: a.analysis,
    serviceOpportunities: a.serviceOpportunities,
    contactHints: a.contactHints,
    technical: a.technical,
    analysisError: null,
  };
  return { ...patch, rankScore: rankScoreFor({ ...patch, opportunityScore: a.overallScore }) ?? undefined };
}

function candidateFromResult(r: ResearchResult): DiscoveredCandidate {
  return {
    id: r.id,
    name: r.companyName,
    website: r.website ?? '',
    city: r.city,
    country: r.country,
    sectorFit: r.discovery?.sectorFit ?? '',
    profileFit: r.discovery?.profileFit ?? 'unknown',
    confidence: r.discovery?.confidence ?? 'low',
    evidence: r.evidence ?? [],
  };
}

/**
 * Analyzes the given results in batches. Used for the first pass and for "retry failed".
 * Returns the progress counters it added.
 */
export async function analyzeResults(
  ctx: RunnerContext,
  results: ResearchResult[],
  cb: RunnerCallbacks,
  progress: RealResearchProgress,
): Promise<RealResearchProgress> {
  let p = { ...progress };
  const update = (next: Partial<RealResearchProgress>) => {
    p = { ...p, ...next };
    p.stage = p.inspected < p.toAnalyze ? 'inspecting' : p.analyzed + p.failed < p.toAnalyze ? 'analyzing' : 'finalizing';
    cb.patchRequest({ progress: p, updatedAt: nowIso(ctx) });
  };
  const size = REAL_RESEARCH_LIMITS.analyzeBatchSize;

  for (let i = 0; i < results.length; i += size) {
    if (ctx.signal.aborted) break;
    const batch = results.slice(i, i + size);
    const pending = new Set(batch.map((r) => r.id));
    try {
      await ctx.api.analyze(
        { criteria: ctx.criteria, candidates: batch.map(candidateFromResult) },
        (event) => {
          if (event.type === 'inspected') update({ inspected: p.inspected + 1 });
          if (event.type === 'analyzed' && pending.delete(event.candidateId)) {
            cb.patchResult(event.candidateId, resultPatchFromAnalysis(event.result));
            update({ analyzed: p.analyzed + 1 });
          }
          if (event.type === 'failed' && pending.delete(event.candidateId)) {
            cb.patchResult(event.candidateId, { researchStatus: 'failed', analysisError: event.message });
            update({ failed: p.failed + 1 });
          }
        },
        ctx.signal,
      );
      // Anything the stream did not report (e.g. server error event) counts as failed.
      for (const id of pending) {
        cb.patchResult(id, { researchStatus: 'failed', analysisError: RESEARCH_ERROR_MESSAGES.internal });
        update({ failed: p.failed + 1, inspected: Math.min(p.toAnalyze, p.inspected + 1) });
      }
    } catch (e) {
      const code: ResearchErrorCode = e instanceof ResearchApiError ? e.code : 'internal';
      if (code === 'cancelled' || ctx.signal.aborted) break;
      for (const id of pending) {
        cb.patchResult(id, { researchStatus: 'failed', analysisError: RESEARCH_ERROR_MESSAGES[code] });
        update({ failed: p.failed + 1, inspected: Math.min(p.toAnalyze, p.inspected + 1) });
      }
      if (FATAL.includes(code)) {
        cb.patchRequest({ errorMessage: RESEARCH_ERROR_MESSAGES[code] });
        break;
      }
    }
  }
  return p;
}

export async function runRealResearch(ctx: RunnerContext, cb: RunnerCallbacks): Promise<void> {
  let progress: RealResearchProgress = { stage: 'discovering', candidates: 0, toAnalyze: 0, inspected: 0, analyzed: 0, failed: 0 };
  cb.patchRequest({ status: 'running', progress, startedAt: nowIso(ctx) });

  const finish = (patch: Partial<ResearchRequest>) =>
    cb.patchRequest({ status: 'completed', completedAt: nowIso(ctx), updatedAt: nowIso(ctx), ...patch });

  let discovered;
  try {
    const knownHosts = [...new Set(ctx.companies.map((c) => websiteHost(c.website)).filter((h): h is string => !!h))];
    discovered = await ctx.api.discover({ criteria: ctx.criteria, knownHosts }, ctx.signal);
  } catch (e) {
    const code: ResearchErrorCode = e instanceof ResearchApiError ? e.code : 'internal';
    if (code === 'cancelled' || ctx.signal.aborted) {
      return finish({ cancelled: true, errorMessage: RESEARCH_ERROR_MESSAGES.cancelled, progress: { ...progress, stage: 'finalizing' } });
    }
    return cb.patchRequest({ status: 'failed', completedAt: nowIso(ctx), errorMessage: RESEARCH_ERROR_MESSAGES[code], progress: null });
  }

  const created = nowIso(ctx);
  // Canonical CRM country from the criteria; the model's country label is never stored.
  const country = researchResultCountry(ctx.criteria);
  const results: ResearchResult[] = discovered.candidates.map((c) => {
    const existing = findProspectMatch({ name: c.name, website: c.website, country }, ctx.companies);
    return {
      id: ctx.makeId(),
      researchRequestId: ctx.requestId,
      companyName: c.name,
      website: c.website,
      sector: ctx.criteria.sector,
      city: c.city,
      country,
      source: 'web',
      service: ctx.criteria.service,
      opportunityScore: null,
      reason: c.sectorFit,
      companySize: null,
      confidence: c.confidence,
      selected: false,
      alreadyInProspects: existing !== null,
      transferredCompanyId: null,
      researchStatus: existing ? 'existing' : 'discovered',
      createdAt: created,
      evidence: c.evidence,
      discovery: { sectorFit: c.sectorFit, profileFit: c.profileFit, confidence: c.confidence },
    };
  });
  cb.addResults(results);

  const toAnalyze = results.filter((r) => r.researchStatus === 'discovered');
  progress = { ...progress, stage: toAnalyze.length ? 'inspecting' : 'finalizing', candidates: results.length, toAnalyze: toAnalyze.length };
  cb.patchRequest({ progress, resultCount: results.length });

  if (results.length === 0) {
    return finish({ errorMessage: RESEARCH_ERROR_MESSAGES.no_candidates, progress: { ...progress, stage: 'finalizing' } });
  }

  progress = await analyzeResults(ctx, toAnalyze, cb, progress);
  if (ctx.signal.aborted) {
    return finish({ cancelled: true, errorMessage: RESEARCH_ERROR_MESSAGES.cancelled, progress: { ...progress, stage: 'finalizing' } });
  }
  finish({ progress: { ...progress, stage: 'finalizing' } });
}
