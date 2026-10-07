// Loads İşler (read-only /api/work). Fetches on mount, on "Daha eski" and after every action; no polling.
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api/dataApi';
import { tasksApi } from '../../api/tasksApi';
import { COMPLETED_RECENT_DAYS } from '../../domain/tasks';
import type { WorkResponse } from '../../domain/work';

export function useWork() {
  const [completedDays, setCompletedDays] = useState(COMPLETED_RECENT_DAYS);
  const [data, setData] = useState<WorkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);

  const load = useCallback(async (days: number) => {
    current.current?.abort();
    const ctrl = new AbortController();
    current.current = ctrl;
    setLoading(true);
    try {
      const d = await tasksApi.work(days, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(errorMessage(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(completedDays);
    return () => current.current?.abort();
  }, [load, completedDays]);

  return { data, loading, error, completedDays, setCompletedDays, reload: () => load(completedDays) };
}
