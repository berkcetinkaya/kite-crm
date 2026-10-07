// Reporting service (Phase 10): reads existing repositories and the follow-up planner's read-only
// views, then computes the dashboard. Never writes, generates, sends or calls Gmail / Anthropic.
import type { Dashboard, DashboardRange } from '../../src/domain/dashboard';
import type { Store } from '../db/repositories/types';
import type { FollowUpPlanner } from '../followUp/service';
import { buildDashboard } from './dashboard';

export function createReportingService(store: Store, deps: { now?: () => Date; followUps?: FollowUpPlanner | null } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  return {
    dashboard(range: DashboardRange): Dashboard {
      return buildDashboard(
        {
          companies: store.companies.list(),
          sends: store.outreach.listSends(),
          messages: store.outreach.listMessages(),
          followUps: deps.followUps?.readViews() ?? [],
          meetings: store.sales.listMeetings(),
          proposals: store.sales.listProposals(),
          customers: store.customers.list(),
          tasks: store.tasks.listOpen(),
        },
        now(),
        range,
      );
    },
  };
}

export type ReportingService = ReturnType<typeof createReportingService>;
