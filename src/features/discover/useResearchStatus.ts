import { useCallback, useEffect, useState } from 'react';
import { researchApi } from '../../api/researchApi';
import type { ResearchProviderId } from '../../domain/research';

export type ConnectionState =
  | { kind: 'checking' }
  | { kind: 'ready'; provider: ResearchProviderId; maxCompanies: number; maxSearchesPerDiscovery: number | null; maxExtraPages: number | null; realRuns: { today: number; limit: number } | null }
  | { kind: 'not_configured' }
  | { kind: 'unreachable' };

/** Asks our research server whether real research can run. Never contacts Anthropic directly. */
export function useResearchStatus(enabled: boolean): { state: ConnectionState; refresh: () => void } {
  const [state, setState] = useState<ConnectionState>({ kind: 'checking' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ kind: 'checking' });
    researchApi
      .status(controller.signal)
      .then((s) =>
        setState(
          s.ready && s.provider
            ? { kind: 'ready', provider: s.provider, maxCompanies: s.limits.maxCompanies, maxSearchesPerDiscovery: s.maxSearchesPerDiscovery ?? null, maxExtraPages: s.maxExtraPagesPerCompany ?? null, realRuns: s.realRuns ?? null }
            : { kind: 'not_configured' },
        ),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'unreachable' });
      });
    return () => controller.abort();
  }, [enabled, tick]);

  return { state, refresh: useCallback(() => setTick((t) => t + 1), []) };
}
