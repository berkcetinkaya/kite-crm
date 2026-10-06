// Repository interfaces: the only way server code reads or writes persistent data. Routes and
// services depend on these, not on SQL, so another store (e.g. a hosted database) can replace the
// SQLite implementations later without touching the API or the domain.
import type { Company } from '../../../src/domain/company';
import type { MailDraft } from '../../../src/domain/mail/draft';
import type { ResearchRequest, ResearchResult } from '../../../src/domain/research';
import type { OutboundMessage, SyncRun, ThreadMessage } from '../../../src/domain/outreach';
import type { FollowUpSequence, FollowUpStep } from '../../../src/domain/followUp';
import type { Meeting, Proposal } from '../../../src/domain/sales';
import type { AccessRequirement, Customer, CustomerService, OnboardingItem } from '../../../src/domain/customers';

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
  /** First contact drafts only (what Phase 5/6 screens work with). */
  list(): MailDraft[];
  /** Follow up drafts (Phase 7), all sequences. */
  listFollowUps(): MailDraft[];
  /** Any draft by id (first contact or follow up). */
  get(id: string): MailDraft | null;
  /** The company's first contact draft. */
  getByCompany(companyId: string): MailDraft | null;
  /** The follow up draft of one sequence step. */
  getByStep(sequenceId: string, stepNumber: number): MailDraft | null;
  /** Inserts or replaces a draft and its previous versions. */
  save(draft: MailDraft): void;
}

/** Phase 6 mail history: send attempts, thread messages and sync runs (never credentials). */
export interface OutreachRepository {
  /** Newest first. */
  listSends(): OutboundMessage[];
  getSend(id: string): OutboundMessage | null;
  findByIdempotencyKey(key: string): OutboundMessage | null;
  listSendsForDraft(draftId: string): OutboundMessage[];
  /** Fails (UNIQUE) when the draft already has an in-flight, sent or unresolved send. */
  insertSend(send: OutboundMessage, idempotencyKey: string): void;
  /** Updates status, Gmail ids and error fields only; the content snapshot is immutable. */
  updateOutcome(send: OutboundMessage): void;
  /** Sends left "sending" by a stopped server become "ambiguous" (manual review). Returns how many. */
  markInterruptedSends(message: string, at: string): number;
  /** Confirmed sends that have a Gmail thread to synchronize. */
  listThreadSends(): OutboundMessage[];
  /** Confirmed sends of one Gmail thread, oldest first (first contact and its follow ups). */
  listSendsInThread(threadId: string): OutboundMessage[];
  /** Oldest first. */
  listMessages(): ThreadMessage[];
  hasMessage(gmailMessageId: string): boolean;
  countInbound(companyId: string): number;
  /** Stored messages of one Gmail thread, oldest first. */
  listThreadMessages(threadId: string): ThreadMessage[];
  insertMessage(message: ThreadMessage): void;
  saveSyncRun(run: SyncRun): void;
  lastSyncRun(): SyncRun | null;
  lastSuccessfulSyncRun(): SyncRun | null;
  markInterruptedSyncRuns(message: string, at: string): number;
}

/** Phase 7 follow up sequences with their steps. */
export interface FollowUpRepository {
  /** Newest first, with steps. */
  list(): FollowUpSequence[];
  get(id: string): FollowUpSequence | null;
  getByInitialOutbound(outboundId: string): FollowUpSequence | null;
  listByThread(threadId: string): FollowUpSequence[];
  listByCompany(companyId: string): FollowUpSequence[];
  getStep(id: string): FollowUpStep | null;
  /** Inserts or updates a sequence and all its steps. Identity fields are never changed. */
  save(sequence: FollowUpSequence): void;
}

/** Phase 8 sales process: meetings and proposals (with line items). */
export interface SalesRepository {
  /** Newest first. */
  listMeetings(): Meeting[];
  getMeeting(id: string): Meeting | null;
  saveMeeting(meeting: Meeting): void;
  /** Most recently updated first, with items. */
  listProposals(): Proposal[];
  getProposal(id: string): Proposal | null;
  /** Inserts or updates a proposal and replaces its items (in the given order). */
  saveProposal(proposal: Proposal): void;
}

/** Phase 9 customers: one per company, with services, onboarding checklist and access requirements. */
export interface CustomerRepository {
  /** Newest start first, as full aggregates. */
  list(): Customer[];
  get(id: string): Customer | null;
  getByCompany(companyId: string): Customer | null;
  getService(id: string): CustomerService | null;
  getOnboardingItem(id: string): OnboardingItem | null;
  getAccess(id: string): AccessRequirement | null;
  nextOnboardingPosition(customerId: string): number;
  nextAccessPosition(customerId: string): number;
  /** Inserts or updates the customer row only (children are saved individually). */
  saveCustomer(customer: Omit<Customer, 'services' | 'onboarding' | 'access'>): void;
  saveService(service: CustomerService): void;
  saveOnboardingItem(item: OnboardingItem): void;
  deleteOnboardingItem(id: string): void;
  saveAccess(access: AccessRequirement): void;
  deleteAccess(id: string): void;
}

/** Operational settings (JSON per key). Never secrets. */
export interface SettingsRepository {
  get<T>(key: string): T | null;
  set(key: string, value: unknown, at: string): void;
}

export interface Store {
  companies: CompanyRepository;
  research: ResearchRepository;
  mail: MailDraftRepository;
  outreach: OutreachRepository;
  followUps: FollowUpRepository;
  settings: SettingsRepository;
  sales: SalesRepository;
  customers: CustomerRepository;
  /** Runs several repository writes atomically. */
  transaction<T>(fn: () => T): T;
  /**
   * Runs `fn` as a nested, separately revertible part of the current transaction: if it throws, only
   * its writes are undone and the error is returned (the outer transaction continues).
   */
  savepoint<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: unknown };
}
