import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { researchApi, type ResearchApi } from '../../api/researchApi';
import { CURRENT_USER, type Company, type PotentialLevel, type ServiceOpportunity } from '../../domain/company';
import { RECOMMEND_MIN_SCORE } from '../../domain/opportunityAnalysis';
import {
  findProspectMatch,
  isInspectedEvidence,
  researchName,
  type ResearchCriteria,
  type ResearchRequest,
  type ResearchResult,
} from '../../domain/research';
import { scoreBand } from '../../domain/score';
import { canonicalCountryName, researchResultCountry } from '../../domain/locations';
import { generateDemoResults } from '../../data/mock/researchResults';
import { createId } from '../../lib/id';
import { useCompanies, type ContactInput, type NewCompanyInput } from '../companies/CompaniesProvider';
import { INITIAL_RESEARCH_STATE, researchReducer, type ResearchState } from './researchReducer';
import { analyzeResults, runRealResearch, type RunnerCallbacks } from './realResearchRunner';

export interface TransferSummary {
  added: number;
  duplicates: number;
}

export interface ResearchApiContext extends ResearchState {
  /** Creates a demo job and completes it immediately with fictional results (Phase 3). */
  startResearch: (criteria: ResearchCriteria) => ResearchRequest;
  /** Starts a real research job; returns immediately, progress arrives through state. */
  startRealResearch: (criteria: ResearchCriteria, provider: ResearchRequest['provider']) => ResearchRequest | null;
  /** Stops the running real job (keeps partial results). */
  cancelRealResearch: () => void;
  /** Re-analyzes failed (or not yet analyzed) results of a finished real job. */
  retryFailed: (requestId: string) => void;
  /** Id of the real job currently running, if any. Only one runs at a time. */
  runningRequestId: string | null;
  toggleResult: (requestId: string, resultId: string) => void;
  setSelection: (requestId: string, resultIds: string[]) => void;
  /** Adds the selected, non-duplicate results to Potansiyel Müşteriler via CompaniesProvider. */
  transferSelected: (requestId: string) => TransferSummary;
}

const ResearchContext = createContext<ResearchApiContext | null>(null);

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

function companyInputForDemoResult(r: ResearchResult, request: ResearchRequest): NewCompanyInput {
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

/**
 * Owns research jobs and their results. Must sit inside CompaniesProvider. The API client is
 * injectable for tests.
 */
export function ResearchProvider({ children, api = researchApi }: { children: ReactNode; api?: ResearchApi }) {
  const [state, dispatch] = useReducer(researchReducer, INITIAL_RESEARCH_STATE);
  const { companies, addCompany } = useCompanies();
  const running = useRef<{ requestId: string; controller: AbortController } | null>(null);
  const [runningRequestId, setRunningRequestId] = useState<string | null>(null);
  const companiesRef = useRef<readonly Company[]>(companies);
  companiesRef.current = companies;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Abort a running job if the whole app unmounts.
  useEffect(() => () => running.current?.controller.abort(), []);

  const callbacksFor = useCallback(
    (requestId: string): RunnerCallbacks => ({
      patchRequest: (patch) => dispatch({ type: 'patchRequest', requestId, patch }),
      addResults: (results) => dispatch({ type: 'addResults', requestId, results }),
      patchResult: (resultId, patch) => dispatch({ type: 'patchResult', requestId, resultId, patch }),
    }),
    [],
  );

  const startReal = useCallback(
    (criteria: ResearchCriteria, provider: ResearchRequest['provider']): ResearchRequest | null => {
      if (running.current) return null; // one real job at a time
      const at = new Date().toISOString();
      const request: ResearchRequest = {
        ...criteria,
        id: createId('rsch'),
        name: researchName(criteria),
        status: 'running',
        mode: 'real',
        isDemo: false,
        provider,
        createdAt: at,
        updatedAt: at,
        startedAt: at,
        completedAt: null,
        resultCount: 0,
        progress: { stage: 'discovering', candidates: 0, toAnalyze: 0, inspected: 0, analyzed: 0, failed: 0 },
        errorMessage: null,
        cancelled: false,
      };
      dispatch({ type: 'create', request, results: [] });
      const controller = new AbortController();
      running.current = { requestId: request.id, controller };
      setRunningRequestId(request.id);
      void runRealResearch(
        { api, requestId: request.id, criteria, companies: companiesRef.current, signal: controller.signal, makeId: () => createId('res') },
        callbacksFor(request.id),
      ).finally(() => {
        if (running.current?.requestId === request.id) running.current = null;
        setRunningRequestId((id) => (id === request.id ? null : id));
      });
      return request;
    },
    [api, callbacksFor],
  );

  const retry = useCallback(
    (requestId: string) => {
      if (running.current) return;
      const request = stateRef.current.requests.find((q) => q.id === requestId);
      const results = (stateRef.current.resultsByRequest[requestId] ?? []).filter(
        (r) => r.researchStatus === 'failed' || r.researchStatus === 'discovered',
      );
      if (!request || request.mode !== 'real' || results.length === 0 || !request.progress) return;
      const controller = new AbortController();
      running.current = { requestId, controller };
      setRunningRequestId(requestId);
      const cb = callbacksFor(requestId);
      for (const r of results) cb.patchResult(r.id, { researchStatus: 'discovered', analysisError: null });
      const base = request.progress;
      const progress = {
        ...base,
        stage: 'inspecting' as const,
        // The retried companies are counted again from zero.
        failed: Math.max(0, base.failed - results.filter((r) => r.researchStatus === 'failed').length),
        toAnalyze: base.analyzed + results.length,
        inspected: base.analyzed,
      };
      cb.patchRequest({ status: 'running', progress, errorMessage: null, cancelled: false });
      const criteria: ResearchCriteria = {
        service: request.service,
        sector: request.sector,
        country: request.country,
        countryCode: request.countryCode,
        city: request.city,
        companyCount: request.companyCount,
        criteria: request.criteria,
        exclusions: request.exclusions,
      };
      void analyzeResults(
        { api, requestId, criteria, companies: companiesRef.current, signal: controller.signal, makeId: () => createId('res') },
        results,
        cb,
        progress,
      )
        .then((p) =>
          cb.patchRequest({
            status: 'completed',
            completedAt: new Date().toISOString(),
            progress: { ...p, stage: 'finalizing' },
            ...(controller.signal.aborted ? { cancelled: true, errorMessage: 'Araştırma durduruldu.' } : {}),
          }),
        )
        .finally(() => {
          if (running.current?.requestId === requestId) running.current = null;
          setRunningRequestId((id) => (id === requestId ? null : id));
        });
    },
    [api, callbacksFor],
  );

  const value = useMemo<ResearchApiContext>(
    () => ({
      ...state,
      runningRequestId,

      startResearch: (criteria) => {
        const at = new Date().toISOString();
        const id = createId('rsch');
        const results = generateDemoResults({ ...criteria, id }).map((r) => ({
          ...r,
          alreadyInProspects:
            findProspectMatch({ name: r.companyName, website: r.website, country: r.country }, companies) !== null,
        }));
        const request: ResearchRequest = {
          ...criteria,
          id,
          name: researchName(criteria),
          status: 'completed',
          mode: 'demo',
          isDemo: true,
          provider: null,
          createdAt: at,
          updatedAt: at,
          startedAt: at,
          completedAt: at,
          resultCount: results.length,
          progress: null,
          errorMessage: null,
          cancelled: false,
        };
        dispatch({ type: 'create', request, results });
        return request;
      },

      startRealResearch: startReal,
      cancelRealResearch: () => running.current?.controller.abort(),
      retryFailed: retry,

      toggleResult: (requestId, resultId) => dispatch({ type: 'toggleResult', requestId, resultId }),
      setSelection: (requestId, resultIds) => dispatch({ type: 'setSelection', requestId, resultIds }),

      transferSelected: (requestId) => {
        const request = state.requests.find((q) => q.id === requestId);
        const results = state.resultsByRequest[requestId] ?? [];
        if (!request) return { added: 0, duplicates: 0 };

        // Re-check against the live company list (and this batch) so nothing is added twice.
        const known: Pick<Company, 'id' | 'name' | 'website' | 'country'>[] = [...companies];
        const outcomes: Record<string, string | null> = {};
        let added = 0;
        let duplicates = 0;
        for (const r of results) {
          if (!r.selected || r.transferredCompanyId || !isTransferable(r)) continue;
          if (findProspectMatch({ name: r.companyName, website: r.website, country: r.country }, known)) {
            outcomes[r.id] = null;
            duplicates += 1;
            continue;
          }
          const input = r.source === 'web' ? companyInputForWebResult(r, request) : companyInputForDemoResult(r, request);
          const company = addCompany(input);
          known.push(company);
          outcomes[r.id] = company.id;
          added += 1;
        }
        if (added + duplicates > 0) {
          dispatch({ type: 'markTransferred', requestId, outcomes, at: new Date().toISOString() });
        }
        return { added, duplicates };
      },
    }),
    [state, companies, addCompany, startReal, retry, runningRequestId],
  );

  return <ResearchContext.Provider value={value}>{children}</ResearchContext.Provider>;
}

export function useResearch(): ResearchApiContext {
  const ctx = useContext(ResearchContext);
  if (!ctx) throw new Error('useResearch must be used inside ResearchProvider');
  return ctx;
}
