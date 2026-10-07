// SQLite research repository. Jobs and results are rows with explicit ids and relationships
// (result → job, result → transferred company). The evidence-based analysis of each result
// (discovery, verification, evidence, analysis, all service opportunities and signals, contact
// hints, website facts) is one immutable JSON snapshot per result: it is always read and written
// as a whole, so splitting it into tables would add joins without benefit.
import type { RealResearchProgress, ResearchRequest, ResearchResult } from '../../../src/domain/research';
import { websiteHost } from '../../../src/lib/url';
import { fromJson, toJson, transaction, type Db } from '../sqlite';
import type { ResearchRepository } from './types';

type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Fields of a result that live in the snapshot column. */
const SNAPSHOT_KEYS = ['discovery', 'verification', 'evidence', 'analysis', 'serviceOpportunities', 'contactHints', 'technical'] as const;
type Snapshot = Partial<Pick<ResearchResult, (typeof SNAPSHOT_KEYS)[number]>>;

function toJob(r: Row): ResearchRequest {
  return {
    id: s(r.id),
    name: s(r.name),
    mode: s(r.mode) as ResearchRequest['mode'],
    isDemo: s(r.mode) === 'demo',
    provider: sn(r.provider) as ResearchRequest['provider'],
    status: s(r.status) as ResearchRequest['status'],
    service: s(r.service) as ResearchRequest['service'],
    sector: s(r.sector),
    sectorId: sn(r.sector_id),
    country: s(r.country),
    countryCode: sn(r.country_code),
    city: sn(r.city),
    companyCount: Number(r.company_count),
    criteria: s(r.criteria),
    exclusions: s(r.exclusions),
    resultCount: Number(r.result_count),
    progress: fromJson<RealResearchProgress>(r.progress_json) ?? null,
    errorMessage: sn(r.error_message),
    cancelled: Number(r.cancelled) === 1,
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
    startedAt: sn(r.started_at),
    completedAt: sn(r.completed_at),
  };
}

function toResult(r: Row): ResearchResult {
  const snapshot = fromJson<Snapshot>(r.snapshot_json) ?? {};
  const result: ResearchResult = {
    id: s(r.id),
    researchRequestId: s(r.job_id),
    companyName: s(r.company_name),
    website: sn(r.website),
    sector: s(r.sector),
    city: sn(r.city),
    country: s(r.country),
    source: s(r.source) as ResearchResult['source'],
    service: s(r.service) as ResearchResult['service'],
    opportunityScore: nn(r.opportunity_score),
    reason: s(r.reason),
    companySize: sn(r.company_size) as ResearchResult['companySize'],
    confidence: s(r.confidence) as ResearchResult['confidence'],
    selected: Number(r.selected) === 1,
    alreadyInProspects: Number(r.already_in_prospects) === 1,
    transferredCompanyId: sn(r.transferred_company_id),
    researchStatus: s(r.research_status) as ResearchResult['researchStatus'],
    createdAt: s(r.created_at),
    analysisError: sn(r.analysis_error),
  };
  if (r.rank_score !== null && r.rank_score !== undefined) result.rankScore = Number(r.rank_score);
  for (const k of SNAPSHOT_KEYS) if (snapshot[k] !== undefined) (result as unknown as Record<string, unknown>)[k] = snapshot[k];
  return result;
}

export function createResearchRepository(db: Db): ResearchRepository {
  const q = {
    jobs: db.prepare('SELECT * FROM research_jobs ORDER BY created_at DESC, rowid DESC'),
    job: db.prepare('SELECT * FROM research_jobs WHERE id = ?'),
    upsertJob: db.prepare(`INSERT INTO research_jobs (id, name, mode, provider, status, service, sector, sector_id, country, country_code, city,
      company_count, criteria, exclusions, result_count, progress_json, error_message, cancelled, created_at, updated_at, started_at, completed_at)
      VALUES (:id, :name, :mode, :provider, :status, :service, :sector, :sector_id, :country, :country_code, :city,
      :company_count, :criteria, :exclusions, :result_count, :progress_json, :error_message, :cancelled, :created_at, :updated_at, :started_at, :completed_at)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider = excluded.provider, status = excluded.status,
      result_count = excluded.result_count, progress_json = excluded.progress_json, error_message = excluded.error_message,
      cancelled = excluded.cancelled, updated_at = excluded.updated_at, started_at = excluded.started_at, completed_at = excluded.completed_at`),
    results: db.prepare('SELECT * FROM research_results ORDER BY job_id, position'),
    resultsOf: db.prepare('SELECT * FROM research_results WHERE job_id = ? ORDER BY position'),
    maxPos: db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM research_results WHERE job_id = ?'),
    existing: db.prepare('SELECT position, job_id FROM research_results WHERE id = ?'),
    result: db.prepare('SELECT * FROM research_results WHERE id = ?'),
    upsertResult: db.prepare(`INSERT INTO research_results (id, job_id, position, company_name, website, website_host, sector, city, country, source,
      service, opportunity_score, reason, company_size, confidence, selected, already_in_prospects, transferred_company_id, research_status,
      verification_status, verification_confidence, rank_score, analysis_error, snapshot_json, created_at)
      VALUES (:id, :job_id, :position, :company_name, :website, :website_host, :sector, :city, :country, :source,
      :service, :opportunity_score, :reason, :company_size, :confidence, :selected, :already_in_prospects, :transferred_company_id, :research_status,
      :verification_status, :verification_confidence, :rank_score, :analysis_error, :snapshot_json, :created_at)
      ON CONFLICT(id) DO UPDATE SET company_name = excluded.company_name, website = excluded.website, website_host = excluded.website_host,
      sector = excluded.sector, city = excluded.city, country = excluded.country, service = excluded.service,
      opportunity_score = excluded.opportunity_score, reason = excluded.reason, company_size = excluded.company_size,
      confidence = excluded.confidence, selected = excluded.selected, already_in_prospects = excluded.already_in_prospects,
      transferred_company_id = excluded.transferred_company_id, research_status = excluded.research_status,
      verification_status = excluded.verification_status, verification_confidence = excluded.verification_confidence,
      rank_score = excluded.rank_score, analysis_error = excluded.analysis_error, snapshot_json = excluded.snapshot_json`),
    transferred: db.prepare(`SELECT * FROM research_results WHERE transferred_company_id = ? AND source = 'web'
      AND verification_status IS NOT NULL ORDER BY created_at DESC LIMIT 1`),
    interrupt: db.prepare(`UPDATE research_jobs SET status = 'failed', error_message = ?, updated_at = ?, completed_at = COALESCE(completed_at, ?)
      WHERE status = 'running'`),
  };

  return {
    listJobs: () => (q.jobs.all() as Row[]).map(toJob),
    getJob: (id) => {
      const r = q.job.get(id) as Row | undefined;
      return r ? toJob(r) : null;
    },
    saveJob(j) {
      q.upsertJob.run({
        id: j.id,
        name: j.name,
        mode: j.mode,
        provider: j.provider,
        status: j.status,
        service: j.service,
        sector: j.sector,
        sector_id: j.sectorId ?? null,
        country: j.country,
        country_code: j.countryCode,
        city: j.city,
        company_count: j.companyCount,
        criteria: j.criteria,
        exclusions: j.exclusions,
        result_count: j.resultCount,
        progress_json: toJson(j.progress),
        error_message: j.errorMessage,
        cancelled: j.cancelled ? 1 : 0,
        created_at: j.createdAt,
        updated_at: j.updatedAt,
        started_at: j.startedAt,
        completed_at: j.completedAt,
      });
    },
    listResultsByJob() {
      const out: Record<string, ResearchResult[]> = {};
      for (const r of q.results.all() as Row[]) (out[s(r.job_id)] ??= []).push(toResult(r));
      return out;
    },
    listResults: (jobId) => (q.resultsOf.all(jobId) as Row[]).map(toResult),
    getResult(id) {
      const row = q.result.get(id) as Row | undefined;
      return row ? toResult(row) : null;
    },
    saveResults(jobId, results) {
      transaction(db, () => {
        let next = Number((q.maxPos.get(jobId) as { p: number }).p) + 1;
        for (const r of results) {
          const existing = q.existing.get(r.id) as { position: number; job_id: string } | undefined;
          if (existing && existing.job_id !== jobId) throw new Error(`Result ${r.id} belongs to another job`);
          const snapshot: Snapshot = {};
          for (const k of SNAPSHOT_KEYS) if (r[k] !== undefined) (snapshot as Record<string, unknown>)[k] = r[k];
          q.upsertResult.run({
            id: r.id,
            job_id: jobId,
            position: existing ? existing.position : next++,
            company_name: r.companyName,
            website: r.website,
            website_host: websiteHost(r.website),
            sector: r.sector,
            city: r.city,
            country: r.country,
            source: r.source,
            service: r.service,
            opportunity_score: r.opportunityScore,
            reason: r.reason,
            company_size: r.companySize,
            confidence: r.confidence,
            selected: r.selected ? 1 : 0,
            already_in_prospects: r.alreadyInProspects ? 1 : 0,
            transferred_company_id: r.transferredCompanyId,
            research_status: r.researchStatus,
            verification_status: r.verification?.status ?? null,
            verification_confidence: r.verification?.confidence ?? null,
            rank_score: r.rankScore ?? null,
            analysis_error: r.analysisError ?? null,
            snapshot_json: JSON.stringify(snapshot),
            created_at: r.createdAt,
          });
        }
      });
    },
    findTransferredResult(companyId) {
      const r = q.transferred.get(companyId) as Row | undefined;
      return r ? toResult(r) : null;
    },
    markInterrupted(message, at) {
      return Number(q.interrupt.run(message, at, at).changes);
    },
  };
}
