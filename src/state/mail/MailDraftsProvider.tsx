import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { mailApi, type MailApi } from '../../api/mailApi';
import { dataApi, errorMessage, type DataApi } from '../../api/dataApi';
import { findActiveDraft, type MailDraft, type MailLanguage } from '../../domain/mail/draft';
import type { ServiceKey } from '../../domain/services';
import type { LoadState } from '../companies/CompaniesProvider';
import type { DraftEdits } from './mailReducer';

export interface GenerateOptions {
  service: ServiceKey;
  language: MailLanguage;
  contactId: string | null;
  /** Berk's current text to keep as a previous version (regeneration over edits). */
  preserve: DraftEdits | null;
}

export interface MailDraftsApi {
  drafts: MailDraft[];
  loadState: LoadState;
  loadError: string | null;
  api: MailApi;
  draftFor: (companyId: string) => MailDraft | undefined;
  /**
   * Generates (or regenerates) the company's draft on the server, which also saves it in the same
   * request. Never sends anything. Rejects with a DataApiError (Turkish message, safety problems).
   */
  generate: (companyId: string, options: GenerateOptions, signal?: AbortSignal) => Promise<MailDraft>;
  /** Saves edits on the server; resolves with the stored draft. */
  save: (draftId: string, edits: DraftEdits) => Promise<MailDraft>;
  approve: (draftId: string, edits: DraftEdits) => Promise<MailDraft>;
}

const MailContext = createContext<MailDraftsApi | null>(null);

/**
 * Owns first contact mail drafts in the browser. Drafts live in the server database: they are
 * loaded on start, and generation, saving and approval are server commands, so a refresh reopens
 * the saved draft with its versions and provenance. Never changes a company's sales status.
 */
export function MailDraftsProvider({ children, api = mailApi, data = dataApi }: { children: ReactNode; api?: MailApi; data?: DataApi }) {
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    data
      .listDrafts(controller.signal)
      .then((list) => {
        setDrafts(list);
        setLoadState('ready');
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(e));
        setLoadState('error');
      });
    return () => controller.abort();
  }, [data]);

  const store = useCallback((draft: MailDraft) => {
    setDrafts((list) => [draft, ...list.filter((d) => d.id !== draft.id && d.companyId !== draft.companyId)]);
    return draft;
  }, []);

  const value = useMemo<MailDraftsApi>(
    () => ({
      drafts,
      loadState,
      loadError,
      api,
      draftFor: (companyId) => findActiveDraft(drafts, companyId),
      generate: (companyId, options, signal) => data.generateDraft({ companyId, ...options }, signal).then(store),
      save: (id, edits) => data.saveDraft(id, edits).then(store),
      approve: (id, edits) => data.approveDraft(id, edits).then(store),
    }),
    [drafts, loadState, loadError, api, data, store],
  );

  return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
}

export function useMailDrafts(): MailDraftsApi {
  const ctx = useContext(MailContext);
  if (!ctx) throw new Error('useMailDrafts must be used inside MailDraftsProvider');
  return ctx;
}
