import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import {
  CURRENT_USER,
  type Company,
  type CompanyNote,
  type CompanySource,
  type Contact,
  type ServiceOpportunity,
} from '../../domain/company';
import type { SalesStatus } from '../../domain/salesStatus';
import { getMockCompanies } from '../../data/mock/companies';
import { createId } from '../../lib/id';
import { companiesReducer, type CompanyDetailsPatch } from './companiesReducer';
import { describe, historyEntry } from './events';

export interface NewCompanyInput {
  name: string;
  website: string | null;
  sector: string;
  city: string;
  country: string;
  source: CompanySource;
  opportunities: ServiceOpportunity[];
  opportunityScore: number | null;
  status: SalesStatus;
  owner: string | null;
  note: string;
}

export type ContactInput = Omit<Contact, 'id'>;

export interface CompaniesApi {
  companies: Company[];
  addCompany: (input: NewCompanyInput) => Company;
  updateDetails: (id: string, patch: CompanyDetailsPatch) => void;
  changeStatus: (id: string, status: SalesStatus) => void;
  setOpportunities: (id: string, opportunities: ServiceOpportunity[]) => void;
  addNote: (id: string, content: string) => void;
  addContact: (id: string, contact: ContactInput) => void;
  updateContact: (id: string, contact: Contact) => void;
}

const CompaniesContext = createContext<CompaniesApi | null>(null);

/** Up to three event ids per action is enough (details + status + score). */
const meta = () => ({ at: new Date().toISOString(), author: CURRENT_USER, eventIds: [1, 2, 3].map(() => createId('evt')) });

/**
 * Single owner of company state for the app. Lives above the router so edits survive navigation.
 * Replace the dispatches with API calls when a backend exists; consumers only see CompaniesApi.
 */
export function CompaniesProvider({ children }: { children: ReactNode }) {
  const [companies, dispatch] = useReducer(companiesReducer, undefined, () => getMockCompanies());

  const api = useMemo<CompaniesApi>(
    () => ({
      companies,
      addCompany: (input) => {
        const at = new Date().toISOString();
        const history = [historyEntry('created', describe.created(), at, CURRENT_USER)];
        const notes: CompanyNote[] = [];
        if (input.note.trim()) {
          notes.push({ id: createId('note'), content: input.note.trim(), author: CURRENT_USER, createdAt: at });
          history.unshift(historyEntry('note_added', describe.noteAdded(), at, CURRENT_USER));
        }
        const company: Company = {
          id: createId('cmp'),
          name: input.name,
          website: input.website,
          sector: input.sector,
          city: input.city,
          country: input.country,
          companySize: null,
          source: input.source,
          owner: input.owner,
          status: input.status,
          opportunityScore: input.opportunityScore,
          opportunities: input.opportunities,
          contacts: [],
          notes,
          history,
          lastContactAt: null,
          nextAction: null,
          createdAt: at,
          updatedAt: at,
        };
        dispatch({ type: 'add', company });
        return company;
      },
      updateDetails: (id, patch) => dispatch({ type: 'updateDetails', id, patch, meta: meta() }),
      changeStatus: (id, status) => dispatch({ type: 'changeStatus', id, status, meta: meta() }),
      setOpportunities: (id, opportunities) => dispatch({ type: 'setOpportunities', id, opportunities, meta: meta() }),
      addNote: (id, content) => {
        const m = meta();
        const note: CompanyNote = { id: createId('note'), content, author: CURRENT_USER, createdAt: m.at };
        dispatch({ type: 'addNote', id, note, meta: m });
      },
      addContact: (id, contact) =>
        dispatch({ type: 'addContact', id, contact: { ...contact, id: createId('ct') }, meta: meta() }),
      updateContact: (id, contact) => dispatch({ type: 'updateContact', id, contact, meta: meta() }),
    }),
    [companies],
  );

  return <CompaniesContext.Provider value={api}>{children}</CompaniesContext.Provider>;
}

export function useCompanies(): CompaniesApi {
  const ctx = useContext(CompaniesContext);
  if (!ctx) throw new Error('useCompanies must be used inside CompaniesProvider');
  return ctx;
}
