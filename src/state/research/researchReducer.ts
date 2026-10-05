// Pure research-job state. Separate from company state on purpose: the only link between the two
// is transferring selected results (see ResearchProvider.transferSelected).
import type { ResearchRequest, ResearchResult } from '../../domain/research';

export interface ResearchState {
  /** Newest first. */
  requests: ResearchRequest[];
  resultsByRequest: Record<string, ResearchResult[]>;
}

export const INITIAL_RESEARCH_STATE: ResearchState = { requests: [], resultsByRequest: {} };

export type ResearchAction =
  | { type: 'loaded'; requests: ResearchRequest[]; resultsByRequest: Record<string, ResearchResult[]> }
  | { type: 'replaceResults'; requestId: string; results: ResearchResult[]; request?: ResearchRequest }
  | { type: 'create'; request: ResearchRequest; results: ResearchResult[] }
  | { type: 'patchRequest'; requestId: string; patch: Partial<ResearchRequest> }
  | { type: 'addResults'; requestId: string; results: ResearchResult[] }
  | { type: 'patchResult'; requestId: string; resultId: string; patch: Partial<ResearchResult> }
  | { type: 'toggleResult'; requestId: string; resultId: string }
  | { type: 'setSelection'; requestId: string; resultIds: string[] }
  | {
      type: 'markTransferred';
      requestId: string;
      /** resultId -> new company id, or null when it turned out to be a duplicate. */
      outcomes: Record<string, string | null>;
      at: string;
    };

function updateResults(
  state: ResearchState,
  requestId: string,
  fn: (r: ResearchResult) => ResearchResult,
): ResearchState {
  const results = state.resultsByRequest[requestId];
  if (!results) return state;
  return { ...state, resultsByRequest: { ...state.resultsByRequest, [requestId]: results.map(fn) } };
}

export function researchReducer(state: ResearchState, action: ResearchAction): ResearchState {
  switch (action.type) {
    case 'loaded':
      return { requests: action.requests, resultsByRequest: action.resultsByRequest };

    case 'replaceResults':
      return {
        requests: action.request ? state.requests.map((q) => (q.id === action.requestId ? action.request! : q)) : state.requests,
        resultsByRequest: { ...state.resultsByRequest, [action.requestId]: action.results },
      };

    case 'create':
      return {
        requests: [action.request, ...state.requests],
        resultsByRequest: { ...state.resultsByRequest, [action.request.id]: action.results },
      };

    case 'patchRequest':
      return {
        ...state,
        requests: state.requests.map((q) => (q.id === action.requestId ? { ...q, ...action.patch } : q)),
      };

    case 'addResults':
      return {
        ...state,
        resultsByRequest: {
          ...state.resultsByRequest,
          [action.requestId]: [...(state.resultsByRequest[action.requestId] ?? []), ...action.results],
        },
      };

    case 'patchResult':
      return updateResults(state, action.requestId, (r) => (r.id === action.resultId ? { ...r, ...action.patch } : r));

    case 'toggleResult':
      return updateResults(state, action.requestId, (r) =>
        r.id === action.resultId ? { ...r, selected: !r.selected } : r,
      );

    case 'setSelection': {
      const ids = new Set(action.resultIds);
      return updateResults(state, action.requestId, (r) => ({ ...r, selected: ids.has(r.id) }));
    }

    case 'markTransferred': {
      const next = updateResults(state, action.requestId, (r) => {
        if (!(r.id in action.outcomes)) return r;
        const companyId = action.outcomes[r.id];
        return { ...r, selected: false, alreadyInProspects: true, transferredCompanyId: companyId ?? null };
      });
      return {
        ...next,
        requests: next.requests.map((q) => (q.id === action.requestId ? { ...q, updatedAt: action.at } : q)),
      };
    }
  }
}
