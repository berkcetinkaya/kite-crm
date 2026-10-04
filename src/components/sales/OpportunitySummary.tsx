import { sortOpportunities, type ServiceOpportunity } from '../../domain/company';
import { SERVICES } from '../../domain/services';

/**
 * Primary (highest-scoring) service plus "+N" for the rest. The full list is in the title tooltip
 * and in screen-reader text, and always visible in the company detail.
 */
export function OpportunitySummary({ opportunities }: { opportunities: ServiceOpportunity[] }) {
  if (opportunities.length === 0) {
    return <span className="text-subtle">Belirlenmedi</span>;
  }
  const [primary, ...rest] = sortOpportunities(opportunities);
  const all = [primary, ...rest].map((o) => `${SERVICES[o.service].label}${o.score !== null ? ` (${o.score})` : ''}`);

  return (
    <span className="opp-summary" title={all.join(', ')}>
      <span className="service-tag">{SERVICES[primary.service].label}</span>
      {rest.length > 0 && (
        <>
          <span className="opp-summary__more" aria-hidden="true">
            +{rest.length}
          </span>
          <span className="visually-hidden">
            , diğer fırsatlar: {rest.map((o) => SERVICES[o.service].label).join(', ')}
          </span>
        </>
      )}
    </span>
  );
}
