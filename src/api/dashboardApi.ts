// Browser client for the read-only Ana Sayfa dashboard (Phase 10).
import type { Dashboard, DashboardRange } from '../domain/dashboard';
import { request } from './dataApi';

export const dashboardApi = {
  get: (range: DashboardRange, signal?: AbortSignal) => request<Dashboard>('GET', `/api/dashboard?range=${encodeURIComponent(range)}`, undefined, signal),
};
