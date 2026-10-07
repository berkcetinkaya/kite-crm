// Work service (Phase 11): read-only. Reads existing repositories and the follow-up planner's
// read-only views and derives every open work item. Never writes, generates, sends or calls Gmail.
import { COMPLETED_OLDER_DAYS } from '../../src/domain/tasks';
import type { WorkResponse } from '../../src/domain/work';
import type { Store } from '../db/repositories/types';
import type { FollowUpPlanner } from '../followUp/service';
import { deriveWorkItems, type WorkSnapshot } from './derive';

export function createWorkService(store: Store, deps: { now?: () => Date; followUps?: FollowUpPlanner | null } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const snapshot = (): WorkSnapshot => ({
    companies: store.companies.list(),
    followUps: deps.followUps?.readViews() ?? [],
    meetings: store.sales.listMeetings(),
    proposals: store.sales.listProposals(),
    customers: store.customers.list(),
    tasks: store.tasks.listOpen(),
  });
  return {
    snapshot,
    work(completedDays: number): WorkResponse {
      const at = now();
      const snap = snapshot();
      const since = new Date(Date.parse(at) - Math.min(completedDays, COMPLETED_OLDER_DAYS) * 86_400_000).toISOString();
      return { now: at, items: deriveWorkItems(snap, at), tasks: snap.tasks ?? [], completed: store.tasks.listDoneSince(since), completedDays };
    },
  };
}

export type WorkServiceApi = ReturnType<typeof createWorkService>;
