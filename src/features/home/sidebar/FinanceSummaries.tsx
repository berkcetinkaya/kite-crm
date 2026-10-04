import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import type { KiteFinanceSummary, PersonalFinanceSummary } from '../../../lib/types';
import { formatCurrency } from '../../../lib/format';

interface Row {
  label: string;
  value: number;
  emphasis?: boolean;
  tone?: 'positive' | 'negative' | 'muted';
}

function FinanceRows({ rows }: { rows: Row[] }) {
  return (
    <dl className="finance">
      {rows.map((r) => (
        <div key={r.label} className={r.emphasis ? 'finance__row finance__row--total' : 'finance__row'}>
          <dt>{r.label}</dt>
          <dd className={r.tone ? `finance__value--${r.tone}` : undefined}>{formatCurrency(r.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="progress">
      <div className="progress__label">
        <span>{label}</span>
        <span>%{pct}</span>
      </div>
      <div className="progress__track" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Preview only: simple subtraction of mock figures, not real accounting.
export function KiteFinanceCard({ data }: { data: KiteFinanceSummary }) {
  const net = data.totalIncome - data.expenses;
  return (
    <Card title="KITE Finans" subtitle="Bu ay" action={<Badge>Önizleme</Badge>}>
      <FinanceRows
        rows={[
          { label: 'Bu Ay Toplam Gelir', value: data.totalIncome },
          { label: 'Tahsil Edilen', value: data.collected, tone: 'positive' },
          { label: 'Tahsil Edilecek', value: data.toCollect, tone: 'muted' },
          { label: 'Giderler', value: data.expenses, tone: 'negative' },
          { label: 'Net', value: net, emphasis: true },
        ]}
      />
      <Progress value={data.collected / data.totalIncome} label="Tahsilat oranı" />
    </Card>
  );
}

export function PersonalFinanceCard({ data }: { data: PersonalFinanceSummary }) {
  const remaining = data.totalIncome - data.totalExpense - data.savingsGoal;
  const spendingBudget = data.totalIncome - data.savingsGoal;
  return (
    <Card title="Berk Kişisel Finans" subtitle="Bu ay" action={<Badge>Önizleme</Badge>}>
      <FinanceRows
        rows={[
          { label: 'Bu Ay Toplam Gelir', value: data.totalIncome },
          { label: 'Toplam Gider', value: data.totalExpense, tone: 'negative' },
          { label: 'Tasarruf Hedefi', value: data.savingsGoal, tone: 'muted' },
          { label: 'Kalan', value: remaining, emphasis: true },
        ]}
      />
      <Progress value={data.totalExpense / spendingBudget} label="Harcama bütçesi kullanımı" />
    </Card>
  );
}
