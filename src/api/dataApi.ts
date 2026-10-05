// Browser client for the persistence API. The browser never touches the database; every read and
// write goes through these KITE endpoints. Errors carry the Turkish message from the server.
import type { Company, ServiceOpportunity } from '../domain/company';
import { DATA_UNREACHABLE_MESSAGE, type DataErrorBody } from '../domain/dataApi';
import type { MailDraft, MailLanguage } from '../domain/mail/draft';
import type { ResearchRequest, ResearchResult } from '../domain/research';
import type { SalesStatus } from '../domain/salesStatus';
import type { ServiceKey } from '../domain/services';
import type { ContactInput, NewCompanyInput } from '../state/companies/companyCommands';
import type { CompanyDetailsPatch } from '../state/companies/companiesReducer';

export class DataApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly problems: string[] = [],
  ) {
    super(message);
    this.name = 'DataApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal?.aborted) throw new DataApiError('cancelled', 'İşlem durduruldu.');
    throw new DataApiError('server_unreachable', DATA_UNREACHABLE_MESSAGE);
  }
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as DataErrorBody | null;
    if (payload?.error?.message) throw new DataApiError(payload.error.code, payload.error.message, payload.error.problems ?? []);
    throw new DataApiError('server_unreachable', DATA_UNREACHABLE_MESSAGE);
  }
  return (await res.json()) as T;
}

export interface GenerateDraftOptions {
  companyId: string;
  service: ServiceKey;
  language: MailLanguage;
  contactId: string | null;
  preserve: { selectedSubject: string; body: string } | null;
}

export interface TransferResponse {
  added: number;
  duplicates: number;
  companies: Company[];
  results: ResearchResult[];
  job: ResearchRequest;
}

export const dataApi = {
  // ---- Prospects ----
  listCompanies: (signal?: AbortSignal) => request<{ companies: Company[] }>('GET', '/api/prospects', undefined, signal).then((r) => r.companies),
  createCompany: (input: NewCompanyInput) => request<{ company: Company }>('POST', '/api/prospects', input).then((r) => r.company),
  updateDetails: (id: string, patch: CompanyDetailsPatch) => request<{ company: Company }>('PATCH', `/api/prospects/${id}`, { patch }).then((r) => r.company),
  changeStatus: (id: string, status: SalesStatus) => request<{ company: Company }>('POST', `/api/prospects/${id}/status`, { status }).then((r) => r.company),
  setOpportunities: (id: string, opportunities: ServiceOpportunity[]) =>
    request<{ company: Company }>('PUT', `/api/prospects/${id}/opportunities`, { opportunities }).then((r) => r.company),
  addNote: (id: string, content: string) => request<{ company: Company }>('POST', `/api/prospects/${id}/notes`, { content }).then((r) => r.company),
  addContact: (id: string, contact: ContactInput) => request<{ company: Company }>('POST', `/api/prospects/${id}/contacts`, { contact }).then((r) => r.company),
  updateContact: (id: string, contactId: string, contact: ContactInput) =>
    request<{ company: Company }>('PUT', `/api/prospects/${id}/contacts/${contactId}`, { contact }).then((r) => r.company),

  // ---- Research ----
  listResearch: (signal?: AbortSignal) => request<{ jobs: ResearchRequest[]; resultsByJob: Record<string, ResearchResult[]> }>('GET', '/api/research/jobs', undefined, signal),
  saveJob: (job: ResearchRequest) => request<{ job: ResearchRequest }>('PUT', `/api/research/jobs/${job.id}`, { job }).then((r) => r.job),
  saveResults: (jobId: string, results: ResearchResult[]) => request<{ saved: number }>('PUT', `/api/research/jobs/${jobId}/results`, { results }),
  transfer: (jobId: string, resultIds: string[] | null) => request<TransferResponse>('POST', `/api/research/jobs/${jobId}/transfer`, { resultIds }),

  // ---- Mail drafts ----
  listDrafts: (signal?: AbortSignal) => request<{ drafts: MailDraft[] }>('GET', '/api/mail/drafts', undefined, signal).then((r) => r.drafts),
  generateDraft: (options: GenerateDraftOptions, signal?: AbortSignal) => request<{ draft: MailDraft }>('POST', '/api/mail/drafts/generate', options, signal).then((r) => r.draft),
  saveDraft: (id: string, edits: { selectedSubject: string; body: string }) => request<{ draft: MailDraft }>('POST', `/api/mail/drafts/${id}/save`, { edits }).then((r) => r.draft),
  approveDraft: (id: string, edits: { selectedSubject: string; body: string }) => request<{ draft: MailDraft }>('POST', `/api/mail/drafts/${id}/approve`, { edits }).then((r) => r.draft),
};

export type DataApi = typeof dataApi;

/** Turkish message for any error thrown while saving or loading. */
export function errorMessage(e: unknown): string {
  return e instanceof DataApiError ? e.message : 'Beklenmeyen bir hata oluştu. Değişiklik kaydedilmemiş olabilir.';
}
