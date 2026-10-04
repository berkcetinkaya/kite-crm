import { ArrowRight } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { FunnelStageCount } from '../../../lib/types';
import { SALES_STATUS } from '../../../domain/salesStatus';

export function SalesFunnelSummary({ stages }: { stages: FunnelStageCount[] }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  const active = stages.filter((s) => s.stage !== 'client').reduce((sum, s) => sum + s.count, 0);

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
        {stages.map((s) => (
          <li key={s.stage} className={s.stage === 'client' ? 'funnel__stage funnel__stage--won' : 'funnel__stage'}>
            <span className="funnel__count">{s.count}</span>
            <span className="funnel__label">{SALES_STATUS[s.stage].stageLabel}</span>
            <span className="funnel__bar" aria-hidden="true">
              <span style={{ width: `${(s.count / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
