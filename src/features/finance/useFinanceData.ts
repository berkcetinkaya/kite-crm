// Loads one finance side on mount and keeps the fresh data every mutation returns. No polling.
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api/dataApi';

export function useFinanceData<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    current.current?.abort();
    const ctrl = new AbortController();
    current.current = ctrl;
    setLoading(true);
    try {
      const d = await load(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(errorMessage(e));
    }
    setLoading(false);
  }, [load]);

  useEffect(() => {
    void reload();
    return () => current.current?.abort();
  }, [reload]);

  /** Runs a mutation and adopts the data it returns; throws so the caller can show the error. */
  const mutate = useCallback(async (call: () => Promise<T>) => {
    const d = await call();
    setData(d);
    return d;
  }, []);

  return { data, loading, error, reload, mutate };
}
