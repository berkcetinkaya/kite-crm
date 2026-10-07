// Browser client for outreach preparation (Phase 13). Nothing here sends email or approves a draft.
import type { BatchItemResult, GenerateMode, PreparationDetail, PreparationOverviewItem, PreparationPatch } from '../domain/outreachPrep';
import { request } from './dataApi';

const enc = encodeURIComponent;

export const outreachPrepApi = {
  overview: (signal?: AbortSignal) => request<{ items: PreparationOverviewItem[]; realGenerations: { today: number; limit: number } }>('GET', '/api/outreach-prep', undefined, signal),
  detail: (companyId: string, signal?: AbortSignal) => request<PreparationDetail>('GET', `/api/outreach-prep/${enc(companyId)}`, undefined, signal),
  update: (companyId: string, patch: PreparationPatch) => request<PreparationDetail>('PUT', `/api/outreach-prep/${enc(companyId)}`, { patch }),
  generate: (companyId: string, options: { mode: GenerateMode; variants?: boolean; replaceEdits?: boolean }, signal?: AbortSignal) =>
    request<PreparationDetail>('POST', `/api/outreach-prep/${enc(companyId)}/generate`, options, signal),
  useVariant: (companyId: string, variantId: string, replaceEdits: boolean) =>
    request<PreparationDetail>('POST', `/api/outreach-prep/${enc(companyId)}/variants/${enc(variantId)}/use`, { replaceEdits }),
  batch: (companyIds: string[], signal?: AbortSignal) => request<{ results: BatchItemResult[] }>('POST', '/api/outreach-prep/batch', { companyIds }, signal),
};
