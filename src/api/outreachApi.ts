// Browser client for Gmail connection and outreach (Phase 6). The browser never sees OAuth tokens,
// the client secret or the credential key: it only receives connection state and mail history.
import type { Company } from '../domain/company';
import type { GmailStatusResponse, OutboundMessage, SyncRun, ThreadMessage } from '../domain/outreach';
import { request } from './dataApi';

export interface SendResponse {
  send: OutboundMessage;
  company: Company;
  replayed: boolean;
}

export interface SyncResponse {
  run: SyncRun;
  newMessages: ThreadMessage[];
  companies: Company[];
}

// Mutations always send a JSON body: the server only accepts same-origin JSON for them.
export const outreachApi = {
  status: (signal?: AbortSignal) => request<GmailStatusResponse>('GET', '/api/gmail/status', undefined, signal),
  verify: () => request<GmailStatusResponse>('POST', '/api/gmail/verify', {}),
  connect: () => request<{ authUrl: string }>('POST', '/api/gmail/connect', {}),
  disconnect: () => request<GmailStatusResponse>('POST', '/api/gmail/disconnect', {}),
  list: (signal?: AbortSignal) => request<{ sends: OutboundMessage[]; messages: ThreadMessage[] }>('GET', '/api/outreach', undefined, signal),
  send: (input: { draftId: string; companyId: string; contactId: string; idempotencyKey: string }) => request<SendResponse>('POST', '/api/outreach/send', input),
  reconcile: (sendId: string) => request<SendResponse & { found: boolean }>('POST', `/api/outreach/sends/${sendId}/reconcile`, {}),
  markNotSent: (sendId: string) => request<{ send: OutboundMessage }>('POST', `/api/outreach/sends/${sendId}/mark-not-sent`, {}),
  sync: () => request<SyncResponse>('POST', '/api/outreach/sync', {}),
};

export type OutreachApi = typeof outreachApi;

/** Random key for one explicit send confirmation (idempotency across retries). */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `send_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
