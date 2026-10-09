// Sales intelligence service (Phase 14): read-only. One snapshot per call, then the pure shared
// domain (src/domain/salesIntelligence.ts). Never writes, sends, generates, moves stages or creates
// meetings, proposals, customers or follow ups; recommendations are advisory only.
import { companyInsights, salesIntelligence, type SalesInsight, type SalesIntelligence } from '../../src/domain/salesIntelligence';
import type { Store } from '../db/repositories/types';
import type { FollowUpPlanner } from '../followUp/service';
import { collectWorkItems } from '../work/derive';
import { loadSnapshot, readinessFromSnapshot, type Snapshot } from './snapshot';

/** Intelligence over an already loaded snapshot (shared with the dashboard's focus list). */
export function intelligenceFrom(snap: Snapshot, now: string): SalesIntelligence {
  return salesIntelligence({ snapshot: snap, workItems: collectWorkItems(snap, now), readiness: readinessFromSnapshot(snap), now });
}

export class SalesIntelligenceError extends Error {
  constructor(public readonly code: 'not_found') {
    super('Şirket bulunamadı.');
    this.name = 'SalesIntelligenceError';
  }
}

export function createSalesIntelligenceService(store: Store, deps: { now?: () => Date; followUps?: FollowUpPlanner | null } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  return {
    list(): SalesIntelligence {
      return intelligenceFrom(loadSnapshot(store, deps.followUps), now());
    },
    /** One company's insight (also for customers and closed companies, marked as excluded). */
    company(companyId: string): SalesInsight {
      const at = now();
      const snap = loadSnapshot(store, deps.followUps);
      if (!snap.companies.some((c) => c.id === companyId)) throw new SalesIntelligenceError('not_found');
      const insight = companyInsights({ snapshot: snap, workItems: collectWorkItems(snap, at), readiness: readinessFromSnapshot(snap), now: at }).find((i) => i.companyId === companyId);
      return insight!;
    },
  };
}

export type SalesIntelligenceService = ReturnType<typeof createSalesIntelligenceService>;
