// Satış Özeti (current counts) and Seçili dönem (plain range counts, never ratios). Company-level
// momentum lives in Satış Süreci since Phase 14; Ana Sayfa shows Öncelikli Fırsatlar instead.
import { DASHBOARD_RANGE_LABELS, STALLED_DAYS, SUMMARY_STAGES, type Dashboard } from '../../../domain/dashboard';
import { SALES_STATUS } from '../../../domain/salesStatus';
import { formatShortDate } from '../../../lib/date';

export function SalesOverview({ sales }: { sales: Dashboard['sales'] }) {
  const max = Math.max(1, ...SUMMARY_STAGES.map((s) => sales.stageCounts[s]));
  const total = SUMMARY_STAGES.reduce((n, s) => n + sales.stageCounts[s], 0);
  return (
    <section className="card dash-card" aria-labelledby="dash-sales">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="dash-sales" className="card__title">
            Satış Özeti
          </h2>
          <p className="card__subtitle">Şu anki aşamalar</p>
        </div>
        <a className="dash-link" href="#/pipeline">
          Satış Süreci
        </a>
      </header>
      <div className="card__body">
        {total === 0 ? (
          <p className="dash-empty">Henüz satış sürecinde şirket yok.</p>
        ) : (
          <ul className="stage-bars">
            {SUMMARY_STAGES.map((s) => (
              <li key={s} className={`stage-bar${s === 'client' ? ' stage-bar--won' : s === 'lost' ? ' stage-bar--lost' : ''}`}>
                <span className="stage-bar__label">{SALES_STATUS[s].label}</span>
                <span className="stage-bar__track" aria-hidden="true">
                  <span className="stage-bar__fill" style={{ width: `${(sales.stageCounts[s] / max) * 100}%` }} />
                </span>
                <span className="stage-bar__count">{sales.stageCounts[s]}</span>
              </li>
            ))}
          </ul>
        )}
        {sales.stalledCount > 0 && (
          <a className="dash-note dash-note--warn" href="#/pipeline">
            {sales.stalledCount} şirket {STALLED_DAYS}+ gündür hareketsiz · Satış Süreci'nde gör
          </a>
        )}
      </div>
    </section>
  );
}

export function SalesActivity({ dashboard }: { dashboard: Dashboard }) {
  const a = dashboard.sales.activity;
  const rows: [string, number][] = [
    ['Yeni şirket', a.newCompanies],
    ['Gönderilen mail', a.sends],
    ['Gelen yanıt', a.replies],
    ['Yapılan görüşme', a.meetingsHeld],
    ['Gönderilen teklif', a.proposalsSent],
    ['Kabul edilen teklif', a.proposalsAccepted],
    ['Reddedilen teklif', a.proposalsRejected],
    ['Yeni müşteri', a.newCustomers],
  ];
  const entries = SUMMARY_STAGES.filter((s) => a.stageEntries[s] > 0);
  const from = new Date(`${dashboard.range.from}T12:00:00`);
  return (
    <section className="card dash-card" aria-labelledby="dash-activity">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="dash-activity" className="card__title">
            Seçili dönemde
          </h2>
          <p className="card__subtitle">
            {DASHBOARD_RANGE_LABELS[dashboard.range.key]} · {formatShortDate(from)} – bugün
          </p>
        </div>
        <span className="dash-tag">Seçili dönem</span>
      </header>
      <div className="card__body">
        <dl className="activity-grid">
          {rows.map(([label, value]) => (
            <div key={label} className={value === 0 ? 'activity-grid__item activity-grid__item--zero' : 'activity-grid__item'}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="dash-subhead">Aşamaya giriş</p>
        {entries.length === 0 ? (
          <p className="dash-empty dash-empty--inline">Bu dönemde aşama değişikliği yok.</p>
        ) : (
          <ul className="chip-row">
            {entries.map((s) => (
              <li key={s} className="count-chip">
                {SALES_STATUS[s].label} <strong>{a.stageEntries[s]}</strong>
              </li>
            ))}
          </ul>
        )}
        <p className="dash-hint">Dönem içindeki hareketlerin sayısıdır; dönüşüm oranı değildir.</p>
      </div>
    </section>
  );
}
