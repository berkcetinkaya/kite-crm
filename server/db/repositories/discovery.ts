// SQLite repository for Phase 12 prospecting: run details, candidate reviews, re-research versions.
import type { CandidateReview, DiscoveryFilters, DiscoveryRunDetails, ResearchVersion } from '../../../src/domain/prospecting';
import type { Db } from '../sqlite';
import type { DiscoveryRepository } from './types';

type Row = Record<string, unknown>;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const json = <T,>(v: unknown, fallback: T): T => (v === null || v === undefined ? fallback : (JSON.parse(v as string) as T));

const toDetails = (r: Row): DiscoveryRunDetails => ({
  jobId: r.job_id as string,
  provider: r.provider as DiscoveryRunDetails['provider'],
  filters: json<DiscoveryFilters>(r.filters_json, null as unknown as DiscoveryFilters),
  searchQueries: json<string[]>(r.search_queries_json, []),
  searchesUsed: Number(r.searches_used),
  plannedMaxSearches: Number(r.planned_max_searches),
  plannedMaxInspections: Number(r.planned_max_inspections),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const toReview = (r: Row): CandidateReview => ({
  resultId: r.result_id as string,
  status: r.status as CandidateReview['status'],
  rejectReason: sn(r.reject_reason),
  notes: r.notes as string,
  sector: sn(r.sector),
  sectorId: sn(r.sector_id),
  services: json<CandidateReview['services']>(r.services_json, null),
  contacts: json<CandidateReview['contacts']>(r.contacts_json, null),
  duplicateAcks: json<string[]>(r.duplicate_ack_json, []),
  reviewedAt: sn(r.reviewed_at),
  updatedAt: r.updated_at as string,
});

const toVersion = (r: Row): ResearchVersion => ({
  id: r.id as string,
  resultId: r.result_id as string,
  version: Number(r.version),
  snapshot: json<Record<string, unknown>>(r.snapshot_json, {}),
  opportunityScore: r.opportunity_score === null ? null : Number(r.opportunity_score),
  createdAt: r.created_at as string,
});

export function createDiscoveryRepository(db: Db): DiscoveryRepository {
  // Prepared on first use (the store may be built before migrations reach v7 in upgrade tests).
  let prepared: ReturnType<typeof prepare> | null = null;
  const prepare = () => ({
    details: db.prepare('SELECT * FROM research_job_details WHERE job_id = ?'),
    allDetails: db.prepare('SELECT * FROM research_job_details ORDER BY created_at'),
    upsertDetails: db.prepare(`INSERT INTO research_job_details (job_id, provider, family_id, filters_json, search_queries_json, searches_used, planned_max_searches, planned_max_inspections, created_at, updated_at)
      VALUES (:job_id, :provider, :family_id, :filters_json, :search_queries_json, :searches_used, :planned_max_searches, :planned_max_inspections, :created_at, :updated_at)
      ON CONFLICT(job_id) DO UPDATE SET provider = excluded.provider, family_id = excluded.family_id, filters_json = excluded.filters_json,
      search_queries_json = excluded.search_queries_json, searches_used = excluded.searches_used, planned_max_searches = excluded.planned_max_searches,
      planned_max_inspections = excluded.planned_max_inspections, updated_at = excluded.updated_at`),
    realSince: db.prepare("SELECT COUNT(*) AS n FROM research_job_details WHERE provider <> 'fixture' AND created_at >= ?"),
    review: db.prepare('SELECT * FROM candidate_reviews WHERE result_id = ?'),
    allReviews: db.prepare('SELECT * FROM candidate_reviews'),
    upsertReview: db.prepare(`INSERT INTO candidate_reviews (result_id, status, reject_reason, notes, sector, sector_id, services_json, contacts_json, duplicate_ack_json, reviewed_at, updated_at)
      VALUES (:result_id, :status, :reject_reason, :notes, :sector, :sector_id, :services_json, :contacts_json, :duplicate_ack_json, :reviewed_at, :updated_at)
      ON CONFLICT(result_id) DO UPDATE SET status = excluded.status, reject_reason = excluded.reject_reason, notes = excluded.notes, sector = excluded.sector,
      sector_id = excluded.sector_id, services_json = excluded.services_json, contacts_json = excluded.contacts_json,
      duplicate_ack_json = excluded.duplicate_ack_json, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at`),
    versions: db.prepare('SELECT * FROM research_result_versions WHERE result_id = ? ORDER BY version DESC'),
    maxVersion: db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM research_result_versions WHERE result_id = ?'),
    insertVersion: db.prepare('INSERT INTO research_result_versions (id, result_id, version, snapshot_json, opportunity_score, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    pruneVersions: db.prepare('DELETE FROM research_result_versions WHERE result_id = ? AND version <= ?'),
  });
  const q = () => (prepared ??= prepare());

  return {
    getDetails(jobId) {
      const r = q().details.get(jobId) as Row | undefined;
      return r ? toDetails(r) : null;
    },
    listDetails: () => (q().allDetails.all() as Row[]).map(toDetails),
    saveDetails(d) {
      q().upsertDetails.run({
        job_id: d.jobId,
        provider: d.provider,
        family_id: d.filters.familyId,
        filters_json: JSON.stringify(d.filters),
        search_queries_json: JSON.stringify(d.searchQueries),
        searches_used: d.searchesUsed,
        planned_max_searches: d.plannedMaxSearches,
        planned_max_inspections: d.plannedMaxInspections,
        created_at: d.createdAt,
        updated_at: d.updatedAt,
      });
    },
    countRealRunsSince: (since) => Number((q().realSince.get(since) as { n: number }).n),
    getReview(resultId) {
      const r = q().review.get(resultId) as Row | undefined;
      return r ? toReview(r) : null;
    },
    listReviews: () => (q().allReviews.all() as Row[]).map(toReview),
    saveReview(v) {
      q().upsertReview.run({
        result_id: v.resultId,
        status: v.status,
        reject_reason: v.rejectReason,
        notes: v.notes,
        sector: v.sector,
        sector_id: v.sectorId,
        services_json: v.services === null ? null : JSON.stringify(v.services),
        contacts_json: v.contacts === null ? null : JSON.stringify(v.contacts),
        duplicate_ack_json: JSON.stringify(v.duplicateAcks),
        reviewed_at: v.reviewedAt,
        updated_at: v.updatedAt,
      });
    },
    listVersions: (resultId) => (q().versions.all(resultId) as Row[]).map(toVersion),
    addVersion(v, keep) {
      const next = Number((q().maxVersion.get(v.resultId) as { v: number }).v) + 1;
      q().insertVersion.run(v.id, v.resultId, next, JSON.stringify(v.snapshot), v.opportunityScore, v.createdAt);
      q().pruneVersions.run(v.resultId, next - keep);
    },
  };
}
