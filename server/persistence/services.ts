// Persistence services: the server-side commands behind the data API. Each command loads the
// current record, applies the SAME pure domain logic the browser used before (companiesReducer,
// buildNewCompany, transfer builders, mailReducer), and writes the result in one transaction.
// Ids, timestamps and history entries are issued here, never taken from the request.
import type { Company, Contact, ServiceOpportunity } from '../../src/domain/company';
import { findProspectMatch, type ResearchRequest, type ResearchResult } from '../../src/domain/research';
import type { MailDraft, MailLanguage } from '../../src/domain/mail/draft';
import type { SalesStatus } from '../../src/domain/salesStatus';
import type { ServiceKey } from '../../src/domain/services';
import { createId } from '../../src/lib/id';
import { actionMeta, buildNewCompany, type ContactInput, type NewCompanyInput } from '../../src/state/companies/companyCommands';
import { companiesReducer, type CompaniesAction, type CompanyDetailsPatch } from '../../src/state/companies/companiesReducer';
import { buildMailRequest } from '../../src/state/mail/mailRequest';
import { mailReducer, type DraftEdits } from '../../src/state/mail/mailReducer';
import { companyInputForDemoResult, companyInputForWebResult, isTransferable } from '../../src/state/research/transferInput';
import type { Store } from '../db/store';
import { generateMailDraft } from '../mail/generate';
import type { MailProviderAdapter } from '../mail/provider';
import { DataError } from './schema';

const notFound = (what: string) => new DataError('not_found', `${what} bulunamadı.`);

export interface TransferOutcome {
  added: number;
  duplicates: number;
  companies: Company[];
  results: ResearchResult[];
  job: ResearchRequest;
}

export function createPersistenceServices(store: Store, deps: { mailProvider?: MailProviderAdapter | null; now?: () => Date } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  /** Loads, applies one reducer action and saves; returns the stored company. */
  function applyCompanyAction(id: string, makeAction: (meta: ReturnType<typeof actionMeta>) => CompaniesAction): Company {
    return store.transaction(() => {
      const current = store.companies.get(id);
      if (!current) throw notFound('Şirket');
      const [next] = companiesReducer([current], makeAction(actionMeta(now())));
      if (next !== current) store.companies.save(next);
      return next;
    });
  }

  const companies = {
    list: () => store.companies.list(),
    create(input: NewCompanyInput): Company {
      return store.transaction(() => {
        const company = buildNewCompany(input, now());
        store.companies.insert(company);
        return company;
      });
    },
    updateDetails: (id: string, patch: CompanyDetailsPatch) => applyCompanyAction(id, (meta) => ({ type: 'updateDetails', id, patch, meta })),
    changeStatus: (id: string, status: SalesStatus) => applyCompanyAction(id, (meta) => ({ type: 'changeStatus', id, status, meta })),
    setOpportunities: (id: string, opportunities: ServiceOpportunity[]) => applyCompanyAction(id, (meta) => ({ type: 'setOpportunities', id, opportunities, meta })),
    addNote: (id: string, content: string) =>
      applyCompanyAction(id, (meta) => ({ type: 'addNote', id, note: { id: createId('note'), content, author: meta.author, createdAt: meta.at }, meta })),
    addContact: (id: string, contact: ContactInput) =>
      applyCompanyAction(id, (meta) => ({ type: 'addContact', id, contact: { ...contact, id: createId('ct') }, meta })),
    updateContact(id: string, contactId: string, contact: ContactInput): Company {
      return store.transaction(() => {
        const current = store.companies.get(id);
        if (!current) throw notFound('Şirket');
        if (!current.contacts.some((c) => c.id === contactId)) throw notFound('İletişim kişisi');
        const full: Contact = { ...contact, id: contactId };
        return applyCompanyAction(id, (meta) => ({ type: 'updateContact', id, contact: full, meta }));
      });
    },
  };

  const research = {
    list: () => ({ jobs: store.research.listJobs(), resultsByJob: store.research.listResultsByJob() }),
    saveJob(job: ResearchRequest): ResearchRequest {
      store.research.saveJob(job);
      return store.research.getJob(job.id)!;
    },
    saveResults(jobId: string, results: ResearchResult[]): number {
      return store.transaction(() => {
        if (!store.research.getJob(jobId)) throw notFound('Araştırma');
        // Transfer links are owned by the server: keep what is stored, never what the client sent.
        const stored = new Map(store.research.listResults(jobId).map((r) => [r.id, r]));
        store.research.saveResults(
          jobId,
          results.map((r) => {
            const prev = stored.get(r.id);
            return {
              ...r,
              researchRequestId: jobId,
              transferredCompanyId: prev?.transferredCompanyId ?? null,
              alreadyInProspects: r.alreadyInProspects || (prev?.alreadyInProspects ?? false),
              selected: prev?.transferredCompanyId ? false : r.selected,
            };
          }),
        );
        return results.length;
      });
    },
    /**
     * Transfers results to Potansiyel Müşteriler in ONE transaction: duplicate check against the
     * stored companies (and this batch), company creation, and result links. Either all of it is
     * saved or nothing is.
     */
    transfer(jobId: string, resultIds: string[] | null): TransferOutcome {
      return store.transaction(() => {
        const job = store.research.getJob(jobId);
        if (!job) throw notFound('Araştırma');
        const at = now();
        const results = store.research.listResults(jobId);
        const wanted = resultIds ? new Set(resultIds) : null;
        const added: Company[] = [];
        const changed: ResearchResult[] = [];
        let duplicates = 0;
        for (const r of results) {
          const chosen = wanted ? wanted.has(r.id) : r.selected;
          if (!chosen || r.transferredCompanyId || !isTransferable(r)) continue;
          const candidate = { name: r.companyName, website: r.website, country: r.country };
          if (store.companies.findDuplicate(candidate) || findProspectMatch(candidate, added)) {
            duplicates += 1;
            changed.push({ ...r, selected: false, alreadyInProspects: true });
            continue;
          }
          const input = r.source === 'web' ? companyInputForWebResult(r, job) : companyInputForDemoResult(r, job);
          const company = buildNewCompany(input, at);
          store.companies.insert(company);
          added.push(company);
          changed.push({ ...r, selected: false, alreadyInProspects: true, transferredCompanyId: company.id });
        }
        if (changed.length) store.research.saveResults(jobId, changed);
        const updatedJob = changed.length ? { ...job, updatedAt: at } : job;
        if (changed.length) store.research.saveJob(updatedJob);
        return { added: added.length, duplicates, companies: added, results: store.research.listResults(jobId), job: updatedJob };
      });
    },
  };

  const mail = {
    list: () => store.mail.list(),
    /**
     * Generates (or regenerates) a company's draft from the STORED company and its stored research,
     * then saves it. The provider call happens before the write transaction; if generation or
     * validation fails, nothing is saved.
     */
    async generate(options: { companyId: string; service: ServiceKey; language: MailLanguage; contactId: string | null; preserve: DraftEdits | null }, signal?: AbortSignal): Promise<MailDraft> {
      const provider = deps.mailProvider;
      if (!provider) throw new DataError('conflict', 'Mail taslağı üretmek için Anthropic API bağlantısı yapılandırılmalı.');
      const company = store.companies.get(options.companyId);
      if (!company) throw notFound('Şirket');
      const contactId = options.contactId && company.contacts.some((c) => c.id === options.contactId) ? options.contactId : null;
      const research = company.researchRef?.mode === 'real' ? store.research.findTransferredResult(company.id) : null;
      const response = await generateMailDraft(provider, buildMailRequest(company, research, { service: options.service, language: options.language, contactId }), { signal });
      return store.transaction(() => {
        if (!store.companies.get(company.id)) throw notFound('Şirket');
        const existing = store.mail.getByCompany(company.id);
        const [draft] = mailReducer(
          { drafts: existing ? [existing] : [] },
          {
            type: 'generated',
            draftId: existing?.id ?? createId('mail'),
            companyId: company.id,
            options: { service: options.service, language: options.language, contactId, researchJobId: research?.researchRequestId ?? null },
            response,
            at: now(),
            preserve: existing ? options.preserve : null,
          },
        ).drafts;
        store.mail.save(draft);
        return draft;
      });
    },
    save(id: string, edits: DraftEdits): MailDraft {
      return store.transaction(() => {
        const current = store.mail.get(id);
        if (!current) throw notFound('Mail taslağı');
        const [next] = mailReducer({ drafts: [current] }, { type: 'save', id, edits, at: now() }).drafts;
        store.mail.save(next);
        return next;
      });
    },
    approve(id: string, edits: DraftEdits): MailDraft {
      return store.transaction(() => {
        const current = store.mail.get(id);
        if (!current) throw notFound('Mail taslağı');
        const [next] = mailReducer({ drafts: [current] }, { type: 'approve', id, edits, at: now() }).drafts;
        store.mail.save(next);
        return next;
      });
    },
  };

  return { companies, research, mail };
}

export type PersistenceServices = ReturnType<typeof createPersistenceServices>;
