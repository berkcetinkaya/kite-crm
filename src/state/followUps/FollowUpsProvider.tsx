import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DataApiError, errorMessage } from '../../api/dataApi';
import { followUpApi, type FollowUpApi, type FollowUpMutation, type FollowUpSendResponse, type FollowUpState } from '../../api/followUpApi';
import type { FollowUpOverview, FollowUpPlanCandidate, FollowUpSequenceView, FollowUpSettings } from '../../domain/followUp';
import type { MailDraft } from '../../domain/mail/draft';
import type { Company } from '../../domain/company';
import { useCompanies, type LoadState } from '../companies/CompaniesProvider';
import { useOutreach } from '../outreach/OutreachProvider';

export interface FollowUpsContextValue {
  overview: FollowUpOverview | null;
  drafts: MailDraft[];
  loadState: LoadState;
  loadError: string | null;
  /** Newest sequence of a company (the one Berk works with), if any. */
  sequenceFor: (companyId: string) => FollowUpSequenceView | undefined;
  candidateFor: (companyId: string) => FollowUpPlanCandidate | undefined;
  draftFor: (draftId: string | null) => MailDraft | undefined;
  refresh: () => Promise<void>;
  saveSettings: (s: FollowUpSettings) => Promise<FollowUpMutation>;
  createPlan: (companyId: string) => Promise<FollowUpMutation>;
  prepare: (stepId: string, signal?: AbortSignal) => Promise<FollowUpMutation>;
  save: (stepId: string, body: string) => Promise<FollowUpMutation>;
  approve: (stepId: string, body: string) => Promise<FollowUpMutation>;
  postpone: (stepId: string, dueAt: string) => Promise<FollowUpMutation>;
  skip: (stepId: string) => Promise<FollowUpMutation>;
  /** Only from the explicit confirmation "Bu Takip Mailini Gönder". */
  send: (stepId: string, idempotencyKey: string) => Promise<FollowUpSendResponse>;
  stop: (sequenceId: string, reason: string | null) => Promise<FollowUpMutation>;
  resume: (sequenceId: string) => Promise<FollowUpMutation>;
}

const FollowUpsContext = createContext<FollowUpsContextValue | null>(null);

/**
 * Follow up state in the browser (Phase 7). The server decides everything (due dates, blockers,
 * queue groups); this mirrors it and refreshes when outreach history changes. Loading this never
 * generates a draft and never sends anything.
 */
export function FollowUpsProvider({ children, api = followUpApi }: { children: ReactNode; api?: FollowUpApi }) {
  const { companies, upsertCompanies } = useCompanies();
  const { sends, messages, reload: reloadOutreach } = useOutreach();
  const [state, setState] = useState<FollowUpState | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback((s: Partial<FollowUpState>) => {
    if (s.overview && s.drafts) setState({ overview: s.overview, drafts: s.drafts });
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.list());
      setLoadState('ready');
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
      setLoadState((prev) => (prev === 'ready' ? prev : 'error'));
    }
  }, [api, apply]);

  // Initial load, and again whenever sends or replies change (a send creates a plan, a reply ends one)
  // or a company's sales status or contacts change (pause/stop rules, recipient blockers).
  const signature = `${sends.map((s) => `${s.id}:${s.status}`).join(',')}|${messages.length}|${companies.map((c) => `${c.id}:${c.status}:${c.contacts.map((x) => x.email ?? '').join(';')}`).join(',')}`;
  useEffect(() => {
    void refresh();
  }, [refresh, signature]);

  /** Runs a mutation; on errors the server's fresh state (e.g. a reply it just found) is applied too. */
  const run = useCallback(
    async <T extends FollowUpMutation>(fn: () => Promise<T>): Promise<T> => {
      try {
        const r = await fn();
        apply(r);
        return r;
      } catch (e) {
        if (e instanceof DataApiError) {
          apply(e.details as Partial<FollowUpState>);
          const companies = e.details.companies as Company[] | undefined;
          if (companies?.length) upsertCompanies(companies);
          if (e.details.newMessages || e.details.send) void reloadOutreach();
        }
        throw e;
      }
    },
    [apply, upsertCompanies, reloadOutreach],
  );

  const value = useMemo<FollowUpsContextValue>(() => {
    const overview = state?.overview ?? null;
    const drafts = state?.drafts ?? [];
    return {
      overview,
      drafts,
      loadState,
      loadError,
      sequenceFor: (companyId) => overview?.sequences.filter((s) => s.companyId === companyId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
      candidateFor: (companyId) => overview?.candidates.find((c) => c.companyId === companyId),
      draftFor: (draftId) => (draftId ? drafts.find((d) => d.id === draftId) : undefined),
      refresh,
      saveSettings: (s) => run(() => api.saveSettings(s)),
      createPlan: (companyId) => run(() => api.createPlan(companyId)),
      prepare: (stepId, signal) => run(() => api.prepare(stepId, signal)),
      save: (stepId, body) => run(() => api.save(stepId, body)),
      approve: (stepId, body) => run(() => api.approve(stepId, body)),
      postpone: (stepId, dueAt) => run(() => api.postpone(stepId, dueAt)),
      skip: (stepId) => run(() => api.skip(stepId)),
      async send(stepId, idempotencyKey) {
        try {
          const r = await run(() => api.send(stepId, idempotencyKey));
          upsertCompanies([r.company]);
          return r;
        } finally {
          // The send record (sent, failed or unclear) and KITE's own thread message.
          void reloadOutreach();
        }
      },
      stop: (sequenceId, reason) => run(() => api.stop(sequenceId, reason)),
      resume: (sequenceId) => run(() => api.resume(sequenceId)),
    };
  }, [state, loadState, loadError, refresh, run, api, upsertCompanies, reloadOutreach]);

  return <FollowUpsContext.Provider value={value}>{children}</FollowUpsContext.Provider>;
}

export function useFollowUps(): FollowUpsContextValue {
  const ctx = useContext(FollowUpsContext);
  if (!ctx) throw new Error('useFollowUps must be used inside FollowUpsProvider');
  return ctx;
}
