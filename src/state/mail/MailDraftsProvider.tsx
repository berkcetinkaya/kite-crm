import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { mailApi, MailApiError, type MailApi } from '../../api/mailApi';
import { findActiveDraft, type MailDraft, type MailLanguage } from '../../domain/mail/draft';
import type { ServiceKey } from '../../domain/services';
import { createId } from '../../lib/id';
import { useCompanies } from '../companies/CompaniesProvider';
import { useResearch } from '../research/ResearchProvider';
import { buildMailRequest, findResearchForCompany } from './mailRequest';
import { INITIAL_MAIL_STATE, mailReducer, type DraftEdits } from './mailReducer';

export interface GenerateOptions {
  service: ServiceKey;
  language: MailLanguage;
  contactId: string | null;
  /** Berk's current text to keep as a previous version (regeneration over edits). */
  preserve: DraftEdits | null;
}

export interface MailDraftsApi {
  drafts: MailDraft[];
  api: MailApi;
  draftFor: (companyId: string) => MailDraft | undefined;
  /** Generates (or regenerates) the company's draft. Never sends anything. */
  generate: (companyId: string, options: GenerateOptions, signal?: AbortSignal) => Promise<void>;
  save: (draftId: string, edits: DraftEdits) => void;
  approve: (draftId: string, edits: DraftEdits) => void;
}

const MailContext = createContext<MailDraftsApi | null>(null);

/**
 * Owns first contact mail drafts. Reads companies and research results; never changes a company's
 * sales status (that happens in Phase 6, after an actual send).
 */
export function MailDraftsProvider({ children, api = mailApi }: { children: ReactNode; api?: MailApi }) {
  const [state, dispatch] = useReducer(mailReducer, INITIAL_MAIL_STATE);
  const { companies } = useCompanies();
  const { resultsByRequest } = useResearch();

  const generate = useCallback(
    async (companyId: string, options: GenerateOptions, signal?: AbortSignal) => {
      const company = companies.find((c) => c.id === companyId);
      if (!company) throw new MailApiError('invalid_request');
      const research = findResearchForCompany(company, resultsByRequest);
      const response = await api.generate(buildMailRequest(company, research, options), signal);
      const at = new Date().toISOString();
      const draftId = findActiveDraft(state.drafts, companyId)?.id ?? createId('mail');
      dispatch({
        type: 'generated',
        draftId,
        companyId,
        options: { service: options.service, language: options.language, contactId: options.contactId, researchJobId: research?.researchRequestId ?? null },
        response,
        at,
        preserve: options.preserve,
      });
    },
    [api, companies, resultsByRequest, state.drafts],
  );

  const value = useMemo<MailDraftsApi>(
    () => ({
      drafts: state.drafts,
      api,
      draftFor: (companyId) => findActiveDraft(state.drafts, companyId),
      generate,
      save: (id, edits) => dispatch({ type: 'save', id, edits, at: new Date().toISOString() }),
      approve: (id, edits) => dispatch({ type: 'approve', id, edits, at: new Date().toISOString() }),
    }),
    [state.drafts, api, generate],
  );

  return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
}

export function useMailDrafts(): MailDraftsApi {
  const ctx = useContext(MailContext);
  if (!ctx) throw new Error('useMailDrafts must be used inside MailDraftsProvider');
  return ctx;
}
