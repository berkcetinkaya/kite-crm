// Reporting service (Phase 10): reads the shared snapshot (Phase 14: every table once) and computes
// the dashboard, including the Öncelikli Fırsatlar focus list from the shared sales intelligence.
// Never writes, generates, sends or calls Gmail / Anthropic.
import type { Dashboard, DashboardRange } from '../../src/domain/dashboard';
import { focusList } from '../../src/domain/salesIntelligence';
import type { Store } from '../db/repositories/types';
import type { FollowUpPlanner } from '../followUp/service';
import { intelligenceFrom } from '../salesIntelligence/service';
import { loadSnapshot } from '../salesIntelligence/snapshot';
import { buildDashboard } from './dashboard';

export function createReportingService(store: Store, deps: { now?: () => Date; followUps?: FollowUpPlanner | null } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  return {
    dashboard(range: DashboardRange): Dashboard {
      const at = now();
      const snap = loadSnapshot(store, deps.followUps);
      const dashboard = buildDashboard(snap, at, range);
      // Companies already in Bugün are skipped so the two sections never repeat each other.
      const inBugun = new Set(dashboard.attention.map((a) => a.companyId));
      return { ...dashboard, focus: focusList(intelligenceFrom(snap, at).insights, inBugun) };
    },
  };
}

export type ReportingService = ReturnType<typeof createReportingService>;
