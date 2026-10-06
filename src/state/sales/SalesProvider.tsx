import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../../api/dataApi';
import { salesApi, type MeetingCompletionInput, type ProposalTransitionInput, type SalesApi } from '../../api/salesApi';
import type { Meeting, MeetingInput, Proposal, ProposalInput } from '../../domain/sales';
import type { SalesStatus } from '../../domain/salesStatus';
import type { ServiceKey } from '../../domain/services';
import { useCompanies, type LoadState } from '../companies/CompaniesProvider';

export interface SalesState {
  meetings: Meeting[];
  proposals: Proposal[];
  loadState: LoadState;
  loadError: string | null;
  /** Newest first. */
  meetingsFor: (companyId: string) => Meeting[];
  /** Most recently updated first. */
  proposalsFor: (companyId: string) => Proposal[];
  reload: () => Promise<void>;
  createMeeting: (companyId: string, input: MeetingInput, moveCompanyTo: SalesStatus | null) => Promise<Meeting>;
  updateMeeting: (id: string, input: MeetingInput) => Promise<Meeting>;
  completeMeeting: (id: string, input: MeetingCompletionInput) => Promise<Meeting>;
  cancelMeeting: (id: string) => Promise<Meeting>;
  createProposal: (companyId: string, input: ProposalInput, addOpportunities: ServiceKey[]) => Promise<Proposal>;
  updateProposal: (id: string, input: ProposalInput, addOpportunities: ServiceKey[]) => Promise<Proposal>;
  transitionProposal: (id: string, input: ProposalTransitionInput) => Promise<Proposal>;
}

const SalesContext = createContext<SalesState | null>(null);

/**
 * Meetings and proposals in the browser (Phase 8). Every change is confirmed by the server first;
 * the updated company (history, stage, next action, opportunities) is applied from its response.
 */
export function SalesProvider({ children, api = salesApi }: { children: ReactNode; api?: SalesApi }) {
  const { upsertCompanies } = useCompanies();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api.list();
      setMeetings(r.meetings);
      setProposals(r.proposals);
      setLoadState('ready');
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
      setLoadState('error');
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<SalesState>(() => {
    const putMeeting = (m: Meeting) => setMeetings((list) => [m, ...list.filter((x) => x.id !== m.id)].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)));
    const putProposal = (p: Proposal) => setProposals((list) => [p, ...list.filter((x) => x.id !== p.id)]);
    const meeting = async (p: Promise<{ meeting: Meeting; company: Parameters<typeof upsertCompanies>[0][number] }>) => {
      const r = await p;
      putMeeting(r.meeting);
      upsertCompanies([r.company]);
      return r.meeting;
    };
    const proposal = async (p: Promise<{ proposal: Proposal; company: Parameters<typeof upsertCompanies>[0][number] }>) => {
      const r = await p;
      putProposal(r.proposal);
      upsertCompanies([r.company]);
      return r.proposal;
    };
    return {
      meetings,
      proposals,
      loadState,
      loadError,
      meetingsFor: (companyId) => meetings.filter((m) => m.companyId === companyId),
      proposalsFor: (companyId) => proposals.filter((p) => p.companyId === companyId),
      reload,
      createMeeting: (companyId, input, moveCompanyTo) => meeting(api.createMeeting(companyId, input, moveCompanyTo)),
      updateMeeting: (id, input) => meeting(api.updateMeeting(id, input)),
      completeMeeting: (id, input) => meeting(api.completeMeeting(id, input)),
      cancelMeeting: (id) => meeting(api.cancelMeeting(id)),
      createProposal: (companyId, input, add) => proposal(api.createProposal(companyId, input, add)),
      updateProposal: (id, input, add) => proposal(api.updateProposal(id, input, add)),
      transitionProposal: (id, input) => proposal(api.transitionProposal(id, input)),
    };
  }, [meetings, proposals, loadState, loadError, reload, api, upsertCompanies]);

  return <SalesContext.Provider value={value}>{children}</SalesContext.Provider>;
}

export function useSales(): SalesState {
  const ctx = useContext(SalesContext);
  if (!ctx) throw new Error('useSales must be used inside SalesProvider');
  return ctx;
}
