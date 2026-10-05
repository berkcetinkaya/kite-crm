import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { dataApi, errorMessage, type DataApi } from '../../api/dataApi';
import type { Company, Contact, ServiceOpportunity } from '../../domain/company';
import type { SalesStatus } from '../../domain/salesStatus';
import type { CompanyDetailsPatch } from './companiesReducer';
import type { ContactInput, NewCompanyInput } from './companyCommands';

export type { NewCompanyInput, ContactInput } from './companyCommands';
export { migrateCompanySector } from './companyCommands';

export type LoadState = 'loading' | 'ready' | 'error';

export interface CompaniesApi {
  companies: Company[];
  /** Server load state: show a loader or the Turkish error instead of an empty list. */
  loadState: LoadState;
  loadError: string | null;
  reload: () => void;
  /**
   * Every mutation is saved by the server first; the list only changes after the server stored it
   * (no optimistic updates). Rejects with a DataApiError carrying a Turkish message.
   */
  addCompany: (input: NewCompanyInput) => Promise<Company>;
  updateDetails: (id: string, patch: CompanyDetailsPatch) => Promise<Company>;
  changeStatus: (id: string, status: SalesStatus) => Promise<Company>;
  setOpportunities: (id: string, opportunities: ServiceOpportunity[]) => Promise<Company>;
  addNote: (id: string, content: string) => Promise<Company>;
  addContact: (id: string, contact: ContactInput) => Promise<Company>;
  updateContact: (id: string, contact: Contact) => Promise<Company>;
  /** Merges companies the server created elsewhere (research transfer). */
  upsertCompanies: (companies: Company[]) => void;
}

const CompaniesContext = createContext<CompaniesApi | null>(null);

interface State {
  companies: Company[];
  loadState: LoadState;
  loadError: string | null;
}

type Action =
  | { type: 'loading' }
  | { type: 'loaded'; companies: Company[] }
  | { type: 'failed'; message: string }
  | { type: 'upsert'; companies: Company[] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return { ...state, loadState: 'loading', loadError: null };
    case 'loaded':
      return { companies: action.companies, loadState: 'ready', loadError: null };
    case 'failed':
      return { ...state, loadState: 'error', loadError: action.message };
    case 'upsert': {
      const byId = new Map(action.companies.map((c) => [c.id, c]));
      const updated = state.companies.map((c) => byId.get(c.id) ?? c);
      const known = new Set(state.companies.map((c) => c.id));
      const added = action.companies.filter((c) => !known.has(c.id));
      return { ...state, companies: [...added, ...updated] };
    }
  }
}

/**
 * Owner of company state in the browser. The server database is the durable source: companies are
 * loaded on start and every change goes through the KITE API, so nothing is lost on refresh.
 * The API client is injectable for tests.
 */
export function CompaniesProvider({ children, api = dataApi }: { children: ReactNode; api?: DataApi }) {
  const [state, dispatch] = useReducer(reducer, { companies: [], loadState: 'loading', loadError: null });

  const load = useCallback(
    (signal?: AbortSignal) => {
      dispatch({ type: 'loading' });
      api
        .listCompanies(signal)
        .then((companies) => dispatch({ type: 'loaded', companies }))
        .catch((e) => {
          if (!signal?.aborted) dispatch({ type: 'failed', message: errorMessage(e) });
        });
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const value = useMemo<CompaniesApi>(() => {
    const saved = async (p: Promise<Company>) => {
      const company = await p;
      dispatch({ type: 'upsert', companies: [company] });
      return company;
    };
    return {
      companies: state.companies,
      loadState: state.loadState,
      loadError: state.loadError,
      reload: () => load(),
      addCompany: (input) => saved(api.createCompany(input)),
      updateDetails: (id, patch) => saved(api.updateDetails(id, patch)),
      changeStatus: (id, status) => saved(api.changeStatus(id, status)),
      setOpportunities: (id, opportunities) => saved(api.setOpportunities(id, opportunities)),
      addNote: (id, content) => saved(api.addNote(id, content)),
      addContact: (id, contact) => saved(api.addContact(id, contact)),
      updateContact: (id, contact) => {
        const { id: contactId, ...rest } = contact;
        return saved(api.updateContact(id, contactId, rest));
      },
      upsertCompanies: (companies) => dispatch({ type: 'upsert', companies }),
    };
  }, [state, api, load]);

  return <CompaniesContext.Provider value={value}>{children}</CompaniesContext.Provider>;
}

export function useCompanies(): CompaniesApi {
  const ctx = useContext(CompaniesContext);
  if (!ctx) throw new Error('useCompanies must be used inside CompaniesProvider');
  return ctx;
}
