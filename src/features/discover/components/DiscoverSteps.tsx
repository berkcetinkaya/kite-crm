// Step indicator for real research (Phase 12): Hedef → Keşif → İnceleme → CRM'e Ekle. Purely visual,
// derived from the active run's state; it never starts or skips anything.
import { Check } from 'lucide-react';
import type { ResearchRequest, ResearchResult } from '../../../domain/research';

const STEPS = ['Hedef', 'Keşif', 'İnceleme', "CRM'e Ekle"] as const;

export function DiscoverSteps({ request, results }: { request: ResearchRequest | null; results: ResearchResult[] }) {
  const current = !request ? 0 : request.status === 'running' ? 1 : results.length === 0 ? 0 : results.some((r) => r.transferredCompanyId) ? 3 : 2;
  return (
    <ol className="discover-steps" aria-label="Araştırma adımları">
      {STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'waiting';
        return (
          <li key={label} className={`discover-steps__item discover-steps__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="discover-steps__num">{state === 'done' ? <Check size={12} aria-hidden="true" /> : i + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
