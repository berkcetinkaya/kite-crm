import { CalendarDays, RefreshCw } from 'lucide-react';
import { DASHBOARD_RANGE_LABELS, DASHBOARD_RANGES, type DashboardRange } from '../../../domain/dashboard';
import { formatLongDate } from '../../../lib/date';

interface HomeHeaderProps {
  now: Date;
  range: DashboardRange;
  onRange: (r: DashboardRange) => void;
  onRefresh: () => void;
  loading: boolean;
}

export function HomeHeader({ now, range, onRange, onRefresh, loading }: HomeHeaderProps) {
  return (
    <header className="home-header">
      <div>
        <h1 className="home-header__title">Günaydın Berk 👋</h1>
        <p className="home-header__subtitle">Bugün dikkat isteyenler, satış ve müşteri operasyonu tek bakışta.</p>
      </div>
      <div className="home-header__tools">
        <p className="home-header__date">
          <CalendarDays size={16} aria-hidden="true" />
          <time dateTime={now.toISOString().slice(0, 10)}>{formatLongDate(now)}</time>
        </p>
        <div className="range-select" role="radiogroup" aria-label="Dönem (yalnızca dönem bölümleri)">
          {DASHBOARD_RANGES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} className={range === r ? 'range-select__opt range-select__opt--on' : 'range-select__opt'} onClick={() => onRange(r)}>
              {DASHBOARD_RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <button type="button" className="button button--ghost button--sm" onClick={onRefresh} disabled={loading} aria-label="Özeti yenile">
          <RefreshCw size={14} aria-hidden="true" className={loading ? 'spin' : undefined} /> Yenile
        </button>
      </div>
    </header>
  );
}
