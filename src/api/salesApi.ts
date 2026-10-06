// Browser client for the sales process (Phase 8): meetings and proposals. Nothing here sends email.
import type { Company } from '../domain/company';
import type { Meeting, MeetingInput, Proposal, ProposalInput, ProposalStatus } from '../domain/sales';
import type { SalesStatus } from '../domain/salesStatus';
import type { ServiceKey } from '../domain/services';
import { request } from './dataApi';

export interface MeetingCompletionInput {
  outcome: string;
  notes: string;
  nextActionLabel: string | null;
  nextActionDueAt: string | null;
  setCompanyNextAction: boolean;
  moveCompanyTo?: SalesStatus | null;
}

export interface ProposalTransitionInput {
  to: ProposalStatus;
  sentAt?: string | null;
  decidedAt?: string | null;
  lossReason?: string | null;
  moveCompanyTo?: SalesStatus | null;
}

type WithCompany<T> = T & { company: Company };

export const salesApi = {
  list: (signal?: AbortSignal) => request<{ meetings: Meeting[]; proposals: Proposal[] }>('GET', '/api/sales', undefined, signal),
  createMeeting: (companyId: string, meeting: MeetingInput, moveCompanyTo: SalesStatus | null) =>
    request<WithCompany<{ meeting: Meeting }>>('POST', '/api/sales/meetings', { companyId, meeting, moveCompanyTo }),
  updateMeeting: (id: string, meeting: MeetingInput) => request<WithCompany<{ meeting: Meeting }>>('PUT', `/api/sales/meetings/${id}`, { meeting }),
  completeMeeting: (id: string, input: MeetingCompletionInput) => request<WithCompany<{ meeting: Meeting }>>('POST', `/api/sales/meetings/${id}/complete`, input),
  cancelMeeting: (id: string) => request<WithCompany<{ meeting: Meeting }>>('POST', `/api/sales/meetings/${id}/cancel`, {}),
  createProposal: (companyId: string, proposal: ProposalInput, addOpportunities: ServiceKey[]) =>
    request<WithCompany<{ proposal: Proposal }>>('POST', '/api/sales/proposals', { companyId, proposal, addOpportunities }),
  updateProposal: (id: string, proposal: ProposalInput, addOpportunities: ServiceKey[]) =>
    request<WithCompany<{ proposal: Proposal }>>('PUT', `/api/sales/proposals/${id}`, { proposal, addOpportunities }),
  transitionProposal: (id: string, input: ProposalTransitionInput) => request<WithCompany<{ proposal: Proposal }>>('POST', `/api/sales/proposals/${id}/status`, input),
};

export type SalesApi = typeof salesApi;
