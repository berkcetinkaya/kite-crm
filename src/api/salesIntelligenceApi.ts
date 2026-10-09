// Browser client for the read-only sales intelligence (Phase 14).
import type { SalesInsight, SalesIntelligence } from '../domain/salesIntelligence';
import { request } from './dataApi';

export const salesIntelligenceApi = {
  list: (signal?: AbortSignal) => request<SalesIntelligence>('GET', '/api/sales-intelligence', undefined, signal),
  company: (companyId: string, signal?: AbortSignal) => request<{ insight: SalesInsight }>('GET', `/api/sales-intelligence/${encodeURIComponent(companyId)}`, undefined, signal).then((r) => r.insight),
};
