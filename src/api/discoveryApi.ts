// Browser client for the Phase 12 review layer. Nothing here sends email or creates outreach.
import type { BulkAction, CandidateView, ConversionResult, DiscoveryJobView, ResearchVersion, ReviewPatch } from '../domain/prospecting';
import type { ServiceKey } from '../domain/services';
import { request } from './dataApi';

export const discoveryApi = {
  job: (jobId: string, signal?: AbortSignal) => request<DiscoveryJobView>('GET', `/api/discovery/jobs/${encodeURIComponent(jobId)}`, undefined, signal),
  review: (resultId: string, review: ReviewPatch) => request<{ candidate: CandidateView }>('PUT', `/api/discovery/candidates/${encodeURIComponent(resultId)}/review`, { review }),
  acknowledge: (resultId: string, key: string, confirmed: boolean) =>
    request<{ candidate: CandidateView }>('POST', `/api/discovery/candidates/${encodeURIComponent(resultId)}/duplicate-ack`, { key, confirmed }),
  reresearch: (resultId: string) => request<{ candidate: CandidateView; changes: string[] }>('POST', `/api/discovery/candidates/${encodeURIComponent(resultId)}/reresearch`, {}),
  versions: (resultId: string) => request<{ versions: ResearchVersion[] }>('GET', `/api/discovery/candidates/${encodeURIComponent(resultId)}/versions`),
  bulk: (resultIds: string[], action: BulkAction) => request<{ results: { resultId: string; ok: boolean; message: string }[] }>('POST', '/api/discovery/bulk', { resultIds, action }),
  convert: (items: { resultId: string; services: ServiceKey[] }[]) => request<{ results: ConversionResult[] }>('POST', '/api/discovery/convert', { items }),
};
