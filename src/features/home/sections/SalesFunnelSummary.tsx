import { ArrowRight } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { FunnelStageCount } from '../../../lib/types';

export function SalesFunnelSummary({ stages }: { stages: FunnelStageCount[] }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  const active = stages.filter((s) => s.stage !== 'Müşteri Oldu').reduce((sum, s) => sum + s.count, 0);

  return (
    <Card
      title="Satış Süreci"
      subtitle={`Süreçte ${active} şirket`}
      action={
        <a className="link" href="#/pipeline">
          Tüm süreç <ArrowRight size={14} aria-hidden="true" />
        </a>
      }
    >
      <ol className="funnel">
        {stages.map((s, i) => (
          <li key={s.stage} className={i === stages.length - 1 ? 'funnel__stage funnel__stage--won' : 'funnel__stage'}>
            <span className="funnel__count">{s.count}</span>
            <span className="funnel__label">{s.stage}</span>
            <span className="funnel__bar" aria-hidden="true">
              <span style={{ width: `${(s.count / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
