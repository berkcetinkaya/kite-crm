import type { DailyMetric } from '../../../lib/types';
import { formatNumber } from '../../../lib/format';

function deltaLabel(metric: DailyMetric): { text: string; tone: 'up' | 'down' | 'flat' } {
  const diff = metric.value - metric.previous;
  if (diff > 0) return { text: `+${diff}`, tone: 'up' };
  if (diff < 0) return { text: `−${-diff}`, tone: 'down' };
  return { text: '±0', tone: 'flat' };
}

export function DailyMetrics({ metrics }: { metrics: DailyMetric[] }) {
  return (
    <section aria-labelledby="daily-metrics-title">
      <h2 id="daily-metrics-title" className="visually-hidden">
        Günlük metrikler
      </h2>
      <ul className="metrics">
        {metrics.map((m) => {
          const delta = deltaLabel(m);
          return (
            <li key={m.id} className="metric">
              <p className="metric__label">{m.label}</p>
              <p className="metric__value">
                {formatNumber(m.value)}
                <span className={`metric__delta metric__delta--${delta.tone}`} title={`Dün: ${m.previous}`}>
                  {delta.text}
                  <span className="visually-hidden"> düne göre</span>
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
