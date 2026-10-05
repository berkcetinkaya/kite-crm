// Repository interfaces: the only way server code reads or writes persistent data. Routes and
// services depend on these, not on SQL, so another store (e.g. a hosted database) can replace the
// SQLite implementations later without touching the API or the domain.
import type { Company } from '../../../src/domain/company';
import type { MailDraft } from '../../../src/domain/mail/draft';
import type { ResearchRequest, ResearchResult } from '../../../src/domain/research';

export interface CompanyRepository {
  list(): Company[];
  get(id: string): Company | null;
  /** Inserts a new company with its contacts, notes, history and opportunities. */
  insert(company: Company): void;
  /** Replaces the stored company aggregate (all child rows) with this version. */
  save(company: Company): void;
  /** Existing company that is the same business (website host first, then name + country). */
  findDuplicate(candidate: { name: string; website: string | null; country?: string | null }): Company | null;
}

export interface ResearchRepository {
  /** Newest first. */
  listJobs(): ResearchRequest[];
  getJob(id: string): ResearchRequest | null;
  saveJob(job: ResearchRequest): void;
  /** All results of all jobs, grouped by job id, in result order. */
  listResultsByJob(): Record<string, ResearchResult[]>;
  listResults(jobId: string): ResearchResult[];
  /** Inserts or updates results of one job. */
  saveResults(jobId: string, results: ResearchResult[]): void;
  /** The analyzed web result a company was transferred from, if any. */
  findTransferredResult(companyId: string): ResearchResult | null;
  /** Marks jobs left "running" (server restart, closed tab) as failed. Returns how many. */
  markInterrupted(message: string, at: string): number;
}

export interface MailDraftRepository {
  list(): MailDraft[];
  get(id: string): MailDraft | null;
  getByCompany(companyId: string): MailDraft | null;
  /** Inserts or replaces a draft and its previous versions. */
  save(draft: MailDraft): void;
}

export interface Store {
  companies: CompanyRepository;
  research: ResearchRepository;
  mail: MailDraftRepository;
  /** Runs several repository writes atomically. */
  transaction<T>(fn: () => T): T;
}
