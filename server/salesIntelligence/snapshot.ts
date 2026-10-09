// One read-only snapshot per request (Phase 14): every table needed by the dashboard, İşler, sales
// intelligence and outreach readiness is listed ONCE; everything else is computed in memory. No
// per-company or per-sequence queries.
import type { Company } from '../../src/domain/company';
import type { Customer } from '../../src/domain/customers';
import type { FollowUpSequenceView } from '../../src/domain/followUp';
import type { MailDraft } from '../../src/domain/mail/draft';
import type { OutboundMessage, ThreadMessage } from '../../src/domain/outreach';
import type { OutreachPreparation } from '../../src/domain/outreachPrep';
import { computeReadiness, type LinkedResearch, type Readiness } from '../../src/domain/outreachReadiness';
import type { CandidateReview, DiscoveryRunDetails } from '../../src/domain/prospecting';
import type { ResearchResult } from '../../src/domain/research';
import type { Meeting, Proposal } from '../../src/domain/sales';
import type { Task } from '../../src/domain/tasks';
import type { Store } from '../db/repositories/types';
import type { FollowUpPlanner } from '../followUp/service';

export interface Snapshot {
  companies: Company[];
  sends: OutboundMessage[];
  messages: ThreadMessage[];
  followUps: FollowUpSequenceView[];
  meetings: Meeting[];
  proposals: Proposal[];
  customers: Customer[];
  tasks: Task[];
  /** First contact drafts. */
  drafts: MailDraft[];
  preparations: OutreachPreparation[];
  /** Web research results linked to a CRM company. */
  linkedResults: ResearchResult[];
  reviews: CandidateReview[];
  runDetails: DiscoveryRunDetails[];
}

/** The snapshot without follow-up views: readiness only needs each plan's status (raw sequences). */
export function loadReadinessSnapshot(store: Store) {
  const { followUps: _views, tasks: _tasks, ...rest } = loadSnapshot(store, null);
  return { ...rest, followUps: store.followUps.list() };
}

export function loadSnapshot(store: Store, followUps: FollowUpPlanner | null | undefined): Snapshot {
  const companies = store.companies.list();
  const sends = store.outreach.listSends();
  const messages = store.outreach.listMessages();
  return {
    companies,
    sends,
    messages,
    followUps: followUps?.readViewsFrom({ companies, sends, messages }) ?? [],
    meetings: store.sales.listMeetings(),
    proposals: store.sales.listProposals(),
    customers: store.customers.list(),
    tasks: store.tasks.listOpen(),
    drafts: store.mail.list(),
    preparations: store.outreachPrep.list(),
    linkedResults: Object.values(store.research.listResultsByJob())
      .flat()
      .filter((r) => r.transferredCompanyId && r.source === 'web'),
    reviews: store.discovery.listReviews(),
    runDetails: store.discovery.listDetails(),
  };
}

/**
 * Phase 13 readiness of every company from the snapshot, with the same rules and inputs as the
 * per-company loadReadiness (the transferred result is the latest verified web result).
 */
export function readinessFromSnapshot(snap: Omit<Snapshot, 'followUps' | 'tasks'> & { followUps: readonly Pick<FollowUpSequenceView, 'companyId' | 'status'>[] }): Map<string, Readiness> {
  const latestResult = new Map<string, ResearchResult>();
  for (const r of snap.linkedResults) {
    if (!r.verification) continue;
    const prev = latestResult.get(r.transferredCompanyId!);
    if (!prev || r.createdAt > prev.createdAt) latestResult.set(r.transferredCompanyId!, r);
  }
  const reviews = new Map(snap.reviews.map((r) => [r.resultId, r]));
  const phase12Jobs = new Set(snap.runDetails.map((d) => d.jobId));
  const customers = new Map(snap.customers.map((c) => [c.companyId, c]));
  const preps = new Map(snap.preparations.map((p) => [p.companyId, p]));
  const drafts = new Map(snap.drafts.filter((d) => d.kind !== 'follow_up').map((d) => [d.companyId, d]));
  const sendsBy = new Map<string, OutboundMessage[]>();
  for (const s of snap.sends) sendsBy.set(s.companyId, [...(sendsBy.get(s.companyId) ?? []), s]);
  const followBy = new Map<string, Pick<FollowUpSequenceView, 'companyId' | 'status'>[]>();
  for (const f of snap.followUps) followBy.set(f.companyId, [...(followBy.get(f.companyId) ?? []), f]);
  const out = new Map<string, Readiness>();
  for (const company of snap.companies) {
    const result = latestResult.get(company.id) ?? null;
    const research: LinkedResearch | null = result ? { result, review: reviews.get(result.id) ?? null, phase12: phase12Jobs.has(result.researchRequestId) } : null;
    out.set(
      company.id,
      computeReadiness({
        company,
        companies: snap.companies,
        customer: customers.get(company.id) ?? null,
        sends: sendsBy.get(company.id) ?? [],
        followUps: followBy.get(company.id) ?? [],
        research,
        preparation: preps.get(company.id) ?? null,
        draft: drafts.get(company.id) ?? null,
      }),
    );
  }
  return out;
}
