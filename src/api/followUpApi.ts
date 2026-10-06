// Browser client for follow ups (Phase 7). Every mutation returns the fresh overview and the follow
// up drafts, so the browser never computes due state on its own.
import type { Company } from '../domain/company';
import type { FollowUpOverview, FollowUpSequenceView, FollowUpSettings } from '../domain/followUp';
import type { MailDraft } from '../domain/mail/draft';
import type { OutboundMessage } from '../domain/outreach';
import { request } from './dataApi';

export interface FollowUpState {
  overview: FollowUpOverview;
  drafts: MailDraft[];
}

export interface FollowUpMutation extends FollowUpState {
  sequence?: FollowUpSequenceView;
  draft?: MailDraft;
}

export interface FollowUpSendResponse extends FollowUpState {
  send: OutboundMessage;
  company: Company;
  replayed: boolean;
}

const step = (id: string, action: string) => `/api/follow-ups/steps/${id}/${action}`;

// Mutations always send a JSON body: the server only accepts same-origin JSON for them.
export const followUpApi = {
  list: (signal?: AbortSignal) => request<FollowUpState>('GET', '/api/follow-ups', undefined, signal),
  saveSettings: (settings: FollowUpSettings) => request<FollowUpMutation>('PUT', '/api/follow-ups/settings', { settings }),
  createPlan: (companyId: string) => request<FollowUpMutation>('POST', '/api/follow-ups/plans', { companyId }),
  /** "Takip Taslağını Hazırla": the only call that generates a follow up. */
  prepare: (stepId: string, signal?: AbortSignal) => request<FollowUpMutation>('POST', step(stepId, 'prepare'), {}, signal),
  save: (stepId: string, body: string) => request<FollowUpMutation>('POST', step(stepId, 'save'), { body }),
  approve: (stepId: string, body: string) => request<FollowUpMutation>('POST', step(stepId, 'approve'), { body }),
  postpone: (stepId: string, dueAt: string) => request<FollowUpMutation>('POST', step(stepId, 'postpone'), { dueAt }),
  skip: (stepId: string) => request<FollowUpMutation>('POST', step(stepId, 'skip'), {}),
  send: (stepId: string, idempotencyKey: string) => request<FollowUpSendResponse>('POST', step(stepId, 'send'), { idempotencyKey }),
  stop: (sequenceId: string, reason: string | null) => request<FollowUpMutation>('POST', `/api/follow-ups/sequences/${sequenceId}/stop`, { reason }),
  resume: (sequenceId: string) => request<FollowUpMutation>('POST', `/api/follow-ups/sequences/${sequenceId}/resume`, {}),
};

export type FollowUpApi = typeof followUpApi;
