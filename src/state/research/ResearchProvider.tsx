import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { CURRENT_USER } from '../../domain/company';
import { findProspectMatch, researchName, type ResearchCriteria, type ResearchRequest } from '../../domain/research';
import { generateDemoResults } from '../../data/mock/researchResults';
import { createId } from '../../lib/id';
import { useCompanies } from '../companies/CompaniesProvider';
import { INITIAL_RESEARCH_STATE, researchReducer, type ResearchState } from './researchReducer';

export interface TransferSummary {
  added: number;
  duplicates: number;
}

export interface ResearchApi extends ResearchState {
  /** Creates a research job and immediately completes it with demo results (Phase 3). */
  startResearch: (criteria: ResearchCriteria) => ResearchRequest;
  toggleResult: (requestId: string, resultId: string) => void;
  setSelection: (requestId: string, resultIds: string[]) => void;
  /** Adds the selected, non-duplicate results to Potansiyel Müşteriler via CompaniesProvider. */
  transferSelected: (requestId: string) => TransferSummary;
}

const ResearchContext = createContext<ResearchApi | null>(null);

/**
 * Owns research jobs and their results. In Phase 4 `startResearch` becomes a real (async) job;
 * the rest of the API can stay the same. Must sit inside CompaniesProvider.
 */
export function ResearchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(researchReducer, INITIAL_RESEARCH_STATE);
  const { companies, addCompany } = useCompanies();

  const api = useMemo<ResearchApi>(
    () => ({
      ...state,

      startResearch: (criteria) => {
        const at = new Date().toISOString();
        const id = createId('rsch');
        const results = generateDemoResults({ ...criteria, id }).map((r) => ({
          ...r,
          alreadyInProspects: findProspectMatch({ name: r.companyName, website: r.website }, companies) !== null,
        }));
        const request: ResearchRequest = {
          ...criteria,
          id,
          name: researchName(criteria),
          status: 'completed',
          isDemo: true,
          createdAt: at,
          updatedAt: at,
          startedAt: at,
          completedAt: at,
          resultCount: results.length,
        };
        dispatch({ type: 'create', request, results });
        return request;
      },

      toggleResult: (requestId, resultId) => dispatch({ type: 'toggleResult', requestId, resultId }),
      setSelection: (requestId, resultIds) => dispatch({ type: 'setSelection', requestId, resultIds }),

      transferSelected: (requestId) => {
        const request = state.requests.find((q) => q.id === requestId);
        const results = state.resultsByRequest[requestId] ?? [];
        if (!request) return { added: 0, duplicates: 0 };

        // Re-check against the live company list (and this batch) so nothing is added twice.
        const known = [...companies];
        const outcomes: Record<string, string | null> = {};
        let added = 0;
        let duplicates = 0;
        for (const r of results) {
          if (!r.selected || r.transferredCompanyId) continue;
          if (findProspectMatch({ name: r.companyName, website: r.website }, known)) {
            outcomes[r.id] = null;
            duplicates += 1;
            continue;
          }
          const company = addCompany({
            name: r.companyName,
            website: r.website,
            sector: r.sector,
            city: r.city ?? '',
            country: r.country,
            source: 'research',
            opportunities: [{ service: r.service, score: r.opportunityScore, reason: r.reason, potential: null }],
            opportunityScore: r.opportunityScore,
            status: 'found',
            owner: CURRENT_USER,
            note: '',
            companySize: r.companySize,
            origin: `Araştırma: ${request.name}${request.isDemo ? ' (demo)' : ''}`,
          });
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
    [state, companies, addCompany],
  );

  return <ResearchContext.Provider value={api}>{children}</ResearchContext.Provider>;
}

export function useResearch(): ResearchApi {
  const ctx = useContext(ResearchContext);
  if (!ctx) throw new Error('useResearch must be used inside ResearchProvider');
  return ctx;
}
