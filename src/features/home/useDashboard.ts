// Loads the read-only dashboard snapshot. Fetches on mount, on range change and on "Yenile";
// no polling. The selected range is a per-browser convenience (localStorage, failures ignored).
import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardApi } from '../../api/dashboardApi';
import { errorMessage } from '../../api/dataApi';
import { DEFAULT_DASHBOARD_RANGE, isDashboardRange, type Dashboard, type DashboardRange } from '../../domain/dashboard';

const RANGE_KEY = 'kite.dashboard.range';

function storedRange(): DashboardRange {
  try {
    const v = window.localStorage.getItem(RANGE_KEY);
    return isDashboardRange(v) ? v : DEFAULT_DASHBOARD_RANGE;
  } catch {
    return DEFAULT_DASHBOARD_RANGE;
  }
}

export function useDashboard() {
  const [range, setRangeState] = useState<DashboardRange>(storedRange);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);

  const load = useCallback(async (r: DashboardRange) => {
    current.current?.abort();
    const ctrl = new AbortController();
    current.current = ctrl;
    setLoading(true);
    try {
      const d = await dashboardApi.get(r, ctrl.signal);
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
    void load(range);
    return () => current.current?.abort();
  }, [load, range]);

  const setRange = (r: DashboardRange) => {
    try {
      window.localStorage.setItem(RANGE_KEY, r);
    } catch {
      /* storage unavailable: keep the choice for this visit only */
    }
    setRangeState(r);
  };

  return { data, loading, error, range, setRange, reload: () => load(range) };
}
