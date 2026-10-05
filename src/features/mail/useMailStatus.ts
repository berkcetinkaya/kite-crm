import { useCallback, useEffect, useState } from 'react';
import { mailApi } from '../../api/mailApi';

export type MailConnection =
  | { kind: 'checking' }
  | { kind: 'ready'; provider: 'anthropic' | 'fixture' }
  | { kind: 'not_configured' }
  | { kind: 'unreachable' };

export interface MailStatus {
  state: MailConnection;
  refresh: () => void;
}

/** Asks our server whether drafts can be generated. Never contacts Anthropic directly. */
export function useMailStatus(): MailStatus {
  const [state, setState] = useState<MailConnection>({ kind: 'checking' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'checking' });
    mailApi
      .status(controller.signal)
      .then((s) => setState(s.ready && s.provider ? { kind: 'ready', provider: s.provider } : { kind: 'not_configured' }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'unreachable' });
      });
    return () => controller.abort();
  }, [tick]);

  return { state, refresh: useCallback(() => setTick((t) => t + 1), []) };
}
