import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DataApiError, errorMessage } from '../../api/dataApi';
import { outreachApi, type OutreachApi, type SendResponse, type SyncResponse } from '../../api/outreachApi';
import type { GmailStatusResponse, OutboundMessage, ThreadMessage } from '../../domain/outreach';
import { useCompanies, type LoadState } from '../companies/CompaniesProvider';

export interface OutreachState {
  sends: OutboundMessage[];
  messages: ThreadMessage[];
  loadState: LoadState;
  loadError: string | null;
  gmail: GmailStatusResponse | null;
  /** Turkish message when the Gmail status could not be read at all. */
  gmailError: string | null;
  syncing: boolean;
  /** Sends of one company, newest first. */
  sendsFor: (companyId: string) => OutboundMessage[];
  /** Thread messages of one send, oldest first. */
  messagesFor: (sendId: string) => ThreadMessage[];
  refreshGmail: () => Promise<GmailStatusResponse | null>;
  verifyGmail: () => Promise<GmailStatusResponse>;
  connectGmail: () => Promise<void>;
  disconnectGmail: () => Promise<GmailStatusResponse>;
  /**
   * Sends one approved draft. Only called from the explicit confirmation ("Bu Maili Gönder").
   * Rejects with a DataApiError whose details may carry the stored (failed/unclear) send record.
   */
  send: (input: { draftId: string; companyId: string; contactId: string; idempotencyKey: string }) => Promise<SendResponse>;
  reconcile: (sendId: string) => Promise<SendResponse & { found: boolean }>;
  markNotSent: (sendId: string) => Promise<OutboundMessage>;
  sync: () => Promise<SyncResponse>;
  /** Reloads sends and thread messages (e.g. after a follow up send, Phase 7). */
  reload: () => Promise<void>;
}

const OutreachContext = createContext<OutreachState | null>(null);

/**
 * Owns Gmail connection state and outreach history in the browser. Everything is server-backed:
 * sending, recording and reply synchronization happen on the server; this only mirrors results.
 */
export function OutreachProvider({ children, api = outreachApi }: { children: ReactNode; api?: OutreachApi }) {
  const { upsertCompanies } = useCompanies();
  const [sends, setSends] = useState<OutboundMessage[]>([]);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gmail, setGmail] = useState<GmailStatusResponse | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refreshGmail = useCallback(async () => {
    try {
      const s = await api.status();
      setGmail(s);
      setGmailError(null);
      return s;
    } catch (e) {
      setGmailError(errorMessage(e));
      return null;
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .list(controller.signal)
      .then((r) => {
        setSends(r.sends);
        setMessages(r.messages);
        setLoadState('ready');
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(e));
        setLoadState('error');
      });
    void refreshGmail();
    return () => controller.abort();
  }, [api, refreshGmail]);

  const storeSend = useCallback((send: OutboundMessage) => setSends((list) => [send, ...list.filter((s) => s.id !== send.id)]), []);
  const addMessages = useCallback((list: ThreadMessage[]) => setMessages((prev) => [...prev, ...list.filter((m) => !prev.some((p) => p.id === m.id))]), []);

  const value = useMemo<OutreachState>(
    () => ({
      sends,
      messages,
      loadState,
      loadError,
      gmail,
      gmailError,
      syncing,
      sendsFor: (companyId) => sends.filter((s) => s.companyId === companyId),
      messagesFor: (sendId) => messages.filter((m) => m.outboundId === sendId).sort((a, b) => a.messageAt.localeCompare(b.messageAt)),
      refreshGmail,
      async verifyGmail() {
        const s = await api.verify();
        setGmail(s);
        setGmailError(null);
        return s;
      },
      async connectGmail() {
        const { authUrl } = await api.connect();
        window.location.assign(authUrl);
      },
      async disconnectGmail() {
        const s = await api.disconnect();
        setGmail(s);
        return s;
      },
      async send(input) {
        try {
          const r = await api.send(input);
          storeSend(r.send);
          upsertCompanies([r.company]);
          // KITE's own message is part of the thread.
          void api.list().then((l) => setMessages(l.messages)).catch(() => undefined);
          return r;
        } catch (e) {
          // A failed or unclear send is still recorded on the server: show it.
          const stored = e instanceof DataApiError ? (e.details.send as OutboundMessage | undefined) : undefined;
          if (stored) storeSend(stored);
          throw e;
        }
      },
      async reconcile(sendId) {
        const r = await api.reconcile(sendId);
        storeSend(r.send);
        if (r.found) {
          upsertCompanies([r.company]);
          void api.list().then((l) => setMessages(l.messages)).catch(() => undefined);
        }
        return r;
      },
      async markNotSent(sendId) {
        const { send } = await api.markNotSent(sendId);
        storeSend(send);
        return send;
      },
      async reload() {
        try {
          const l = await api.list();
          setSends(l.sends);
          setMessages(l.messages);
        } catch {
          /* the next load shows the error */
        }
      },
      async sync() {
        setSyncing(true);
        try {
          const r = await api.sync();
          addMessages(r.newMessages);
          if (r.companies.length) upsertCompanies(r.companies);
          return r;
        } catch (e) {
          const details = e instanceof DataApiError ? e.details : {};
          if (Array.isArray(details.newMessages)) addMessages(details.newMessages as ThreadMessage[]);
          if (Array.isArray(details.companies) && details.companies.length) upsertCompanies(details.companies as SyncResponse['companies']);
          throw e;
        } finally {
          setSyncing(false);
          void refreshGmail();
        }
      },
    }),
    [sends, messages, loadState, loadError, gmail, gmailError, syncing, api, refreshGmail, storeSend, addMessages, upsertCompanies],
  );

  return <OutreachContext.Provider value={value}>{children}</OutreachContext.Provider>;
}

export function useOutreach(): OutreachState {
  const ctx = useContext(OutreachContext);
  if (!ctx) throw new Error('useOutreach must be used inside OutreachProvider');
  return ctx;
}
