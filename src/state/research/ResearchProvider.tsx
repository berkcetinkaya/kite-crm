import type { DiscoveryFilters } from '../../domain/prospecting';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { researchApi, type ResearchApi } from '../../api/researchApi';
import { dataApi, errorMessage, type DataApi } from '../../api/dataApi';
import type { Company } from '../../domain/company';
import { findProspectMatch, researchName, type ResearchCriteria, type ResearchRequest, type ResearchResult } from '../../domain/research';
import { generateDemoResults } from '../../data/mock/researchResults';
import { createId } from '../../lib/id';
import { useCompanies, type LoadState } from '../companies/CompaniesProvider';
import { INITIAL_RESEARCH_STATE, researchReducer, type ResearchAction, type ResearchState } from './researchReducer';
import { analyzeResults, runRealResearch, type RunnerCallbacks } from './realResearchRunner';

export { companyInputForDemoResult, companyInputForWebResult, isTransferable } from './transferInput';

export interface TransferSummary {
  added: number;
  duplicates: number;
}

export interface ResearchApiContext extends ResearchState {
  loadState: LoadState;
  loadError: string | null;
  /** Turkish message when saving research history failed (results stay visible but are not stored). */
  persistError: string | null;
  /** Creates a demo job and completes it immediately with fictional results (Phase 3). */
  startResearch: (criteria: ResearchCriteria) => ResearchRequest;
  /** Starts a real research job; returns immediately, progress arrives through state. */
  startRealResearch: (criteria: ResearchCriteria, provider: ResearchRequest['provider'], filters?: DiscoveryFilters) => ResearchRequest | null;
  /** Stops the running real job (keeps partial results). */
  cancelRealResearch: () => void;
  /** Re-analyzes failed (or not yet analyzed) results of a finished real job. */
  retryFailed: (requestId: string) => void;
  /** Id of the real job currently running, if any. Only one runs at a time. */
  runningRequestId: string | null;
  toggleResult: (requestId: string, resultId: string) => void;
  setSelection: (requestId: string, resultIds: string[]) => void;
  /** Adds the selected, non-duplicate results to Potansiyel Müşteriler (one server transaction). */
  transferSelected: (requestId: string) => Promise<TransferSummary>;
  /** Reloads one job's stored results (after server-side review / conversion, Phase 12). */
  refreshJob: (requestId: string) => Promise<void>;
  /** Writes a job's pending result saves now (the review reads stored results). */
  flushJob: (requestId: string) => Promise<void>;
}

const ResearchContext = createContext<ResearchApiContext | null>(null);

/** Shown for jobs that were still running when the page was closed or refreshed. */
export const INTERRUPTED_MESSAGE = 'Araştırma yarıda kaldı (sayfa yenilendi veya kapatıldı). Kaydedilen sonuçlar gösteriliyor.';

const SAVE_DELAY_MS = 150;

/**
 * Owns research jobs and their results. Must sit inside CompaniesProvider. Jobs run in the browser
 * as before (discover → analyze), and every change is written to the server database through a
 * per-job queue, so history and results survive a refresh. API clients are injectable for tests.
 */
export function ResearchProvider({ children, api = researchApi, data = dataApi }: { children: ReactNode; api?: ResearchApi; data?: DataApi }) {
  const [state, dispatchState] = useReducer(researchReducer, INITIAL_RESEARCH_STATE);
  const { companies, upsertCompanies } = useCompanies();
  const running = useRef<{ requestId: string; controller: AbortController } | null>(null);
  const [runningRequestId, setRunningRequestId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const companiesRef = useRef<readonly Company[]>(companies);
  companiesRef.current = companies;
  // Always the latest state, updated synchronously so queued saves never write stale data.
  const stateRef = useRef<ResearchState>(state);

  const dispatch = useCallback((action: ResearchAction) => {
    stateRef.current = researchReducer(stateRef.current, action);
    dispatchState(action);
  }, []);

  // ---------- persistence queue ----------
  const queues = useRef(new Map<string, Promise<void>>());
  const dirty = useRef(new Map<string, { job: boolean; results: Set<string> }>());
  const timers = useRef(new Map<string, number>());

  const enqueue = useCallback((jobId: string, write: () => Promise<unknown>) => {
    const next = (queues.current.get(jobId) ?? Promise.resolve())
      .then(write)
      .then(() => setPersistError(null))
      .catch((e) => setPersistError(`Araştırma kaydedilemedi: ${errorMessage(e)}`));
    queues.current.set(jobId, next);
    return next;
  }, []);

  const flush = useCallback(
    (jobId: string): Promise<void> => {
      const pending = dirty.current.get(jobId);
      window.clearTimeout(timers.current.get(jobId));
      timers.current.delete(jobId);
      dirty.current.delete(jobId);
      if (!pending) return queues.current.get(jobId) ?? Promise.resolve();
      const job = stateRef.current.requests.find((q) => q.id === jobId);
      if (!job) return Promise.resolve();
      if (pending.job) void enqueue(jobId, () => data.saveJob(job));
      const results = (stateRef.current.resultsByRequest[jobId] ?? []).filter((r) => pending.results.has(r.id));
      if (results.length) void enqueue(jobId, () => data.saveResults(jobId, results));
      return queues.current.get(jobId) ?? Promise.resolve();
    },
    [data, enqueue],
  );

  const markDirty = useCallback(
    (jobId: string, change: { job?: boolean; results?: string[] }) => {
      const entry = dirty.current.get(jobId) ?? { job: false, results: new Set<string>() };
      if (change.job) entry.job = true;
      change.results?.forEach((id) => entry.results.add(id));
      dirty.current.set(jobId, entry);
      if (!timers.current.has(jobId)) timers.current.set(jobId, window.setTimeout(() => void flush(jobId), SAVE_DELAY_MS));
    },
    [flush],
  );

  // ---------- load ----------
  useEffect(() => {
    const controller = new AbortController();
    data
      .listResearch(controller.signal)
      .then(({ jobs, resultsByJob }) => {
        // A job still "running" in storage belongs to a page that is gone: mark it interrupted.
        const at = new Date().toISOString();
        const fixed = jobs.map((j) =>
          j.status === 'running' ? { ...j, status: 'failed' as const, completedAt: j.completedAt ?? at, updatedAt: at, errorMessage: INTERRUPTED_MESSAGE } : j,
        );
        dispatch({ type: 'loaded', requests: fixed, resultsByRequest: resultsByJob });
        for (const j of jobs) if (j.status === 'running') markDirty(j.id, { job: true });
        setLoadState('ready');
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(e));
        setLoadState('error');
      });
    return () => controller.abort();
  }, [data, dispatch, markDirty]);

  // Abort a running job if the whole app unmounts.
  useEffect(() => () => running.current?.controller.abort(), []);

  const callbacksFor = useCallback(
    (requestId: string): RunnerCallbacks => ({
      patchRequest: (patch) => {
        dispatch({ type: 'patchRequest', requestId, patch });
        markDirty(requestId, { job: true });
      },
      addResults: (results) => {
        dispatch({ type: 'addResults', requestId, results });
        markDirty(requestId, { results: results.map((r) => r.id) });
      },
      patchResult: (resultId, patch) => {
        dispatch({ type: 'patchResult', requestId, resultId, patch });
        markDirty(requestId, { results: [resultId] });
      },
    }),
    [dispatch, markDirty],
  );

  const create = useCallback(
    (request: ResearchRequest, results: ResearchResult[]) => {
      dispatch({ type: 'create', request, results });
      void enqueue(request.id, () => data.saveJob(request));
      if (results.length) void enqueue(request.id, () => data.saveResults(request.id, results));
    },
    [data, dispatch, enqueue],
  );

  const startReal = useCallback(
    (criteria: ResearchCriteria, provider: ResearchRequest['provider'], filters?: DiscoveryFilters): ResearchRequest | null => {
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
      create(request, []);
      const controller = new AbortController();
      running.current = { requestId: request.id, controller };
      setRunningRequestId(request.id);
      // The job must be stored before discovery: the server records run details against it.
      void (queues.current.get(request.id) ?? Promise.resolve())
        .then(() => runRealResearch({ api, requestId: request.id, criteria, filters, companies: companiesRef.current, signal: controller.signal, makeId: () => createId('res') }, callbacksFor(request.id)))
        .finally(() => {
          if (running.current?.requestId === request.id) running.current = null;
          setRunningRequestId((id) => (id === request.id ? null : id));
        });
      return request;
    },
    [api, callbacksFor, create],
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
        sectorId: request.sectorId ?? null,
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
      loadState,
      loadError,
      persistError,
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
        create(request, results);
        return request;
      },

      startRealResearch: startReal,
      cancelRealResearch: () => running.current?.controller.abort(),
      retryFailed: retry,

      toggleResult: (requestId, resultId) => {
        dispatch({ type: 'toggleResult', requestId, resultId });
        markDirty(requestId, { results: [resultId] });
      },
      setSelection: (requestId, resultIds) => {
        dispatch({ type: 'setSelection', requestId, resultIds });
        markDirty(requestId, { results: (stateRef.current.resultsByRequest[requestId] ?? []).map((r) => r.id) });
      },

      transferSelected: async (requestId) => {
        // Pending result saves go first, then the server transfers in one transaction: duplicate
        // check against the stored companies, company creation and result links together.
        await flush(requestId);
        const selected = (stateRef.current.resultsByRequest[requestId] ?? []).filter((r) => r.selected && !r.transferredCompanyId).map((r) => r.id);
        if (selected.length === 0) return { added: 0, duplicates: 0 };
        const outcome = await data.transfer(requestId, selected);
        dispatch({ type: 'replaceResults', requestId, results: outcome.results, request: outcome.job });
        upsertCompanies(outcome.companies);
        return { added: outcome.added, duplicates: outcome.duplicates };
      },

      flushJob: flush,

      refreshJob: async (requestId) => {
        if (running.current?.requestId === requestId) return;
        await flush(requestId);
        const { jobs, resultsByJob } = await data.listResearch();
        const request = jobs.find((j) => j.id === requestId);
        if (request) dispatch({ type: 'replaceResults', requestId, results: resultsByJob[requestId] ?? [], request });
      },
    }),
    [state, loadState, loadError, persistError, companies, startReal, retry, runningRequestId, create, dispatch, markDirty, flush, data, upsertCompanies],
  );

  return <ResearchContext.Provider value={value}>{children}</ResearchContext.Provider>;
}

export function useResearch(): ResearchApiContext {
  const ctx = useContext(ResearchContext);
  if (!ctx) throw new Error('useResearch must be used inside ResearchProvider');
  return ctx;
}
