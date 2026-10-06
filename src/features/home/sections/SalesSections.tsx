// Satış Özeti (current counts), Seçili dönem (plain range counts, never ratios) and Momentum
// (open-stage companies by days without movement).
import { Badge } from '../../../components/ui/Badge';
import { SalesStatusBadge } from '../../../components/sales/SalesStatusBadge';
import { DASHBOARD_RANGE_LABELS, STALLED_DAYS, SUMMARY_STAGES, type Dashboard } from '../../../domain/dashboard';
import { SALES_STATUS } from '../../../domain/salesStatus';
import { formatShortDate } from '../../../lib/date';
import { daysLabel } from '../dashboardView';

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
          <button type="button" className="dash-note dash-note--warn" onClick={() => document.getElementById('dash-momentum')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {sales.stalledCount} şirket {STALLED_DAYS}+ gündür hareketsiz · Momentum'a git
          </button>
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

export function MomentumTable({ rows, onOpenCompany }: { rows: Dashboard['momentum']; onOpenCompany: (id: string) => void }) {
  return (
    <section className="card dash-card" id="dash-momentum" aria-labelledby="dash-momentum-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="dash-momentum-title" className="card__title">
            Momentum
          </h2>
          <p className="card__subtitle">Açık satış aşamaları · en uzun süredir hareketsiz olan önce</p>
        </div>
      </header>
      <div className="card__body card__body--flush">
        {rows.length === 0 ? (
          <p className="dash-empty">Açık satış aşamasında (İlk Temas – Karar Bekleniyor) şirket yok.</p>
        ) : (
          <div className="momentum-wrap">
            <table className="momentum">
              <thead>
                <tr>
                  <th scope="col">Şirket</th>
                  <th scope="col">Aşama</th>
                  <th scope="col" className="num">
                    Aşamada
                  </th>
                  <th scope="col" className="num">
                    Son mail
                  </th>
                  <th scope="col" className="num">
                    Son yanıt
                  </th>
                  <th scope="col" className="num">
                    Son hareket
                  </th>
                  <th scope="col">Sonraki adım</th>
                  <th scope="col">Sorumlu</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.companyId} className={r.stalled ? 'momentum__row--stalled' : undefined}>
                    <th scope="row">
                      <button type="button" className="link-cell" onClick={() => onOpenCompany(r.companyId)}>
                        {r.name}
                      </button>
                      {r.stalled && <Badge tone="warning">Hareketsiz</Badge>}
                    </th>
                    <td>
                      <SalesStatusBadge status={r.status} />
                    </td>
                    <td className="num">{daysLabel(r.daysInStage)}</td>
                    <td className="num">{daysLabel(r.daysSinceSend)}</td>
                    <td className="num">{daysLabel(r.daysSinceReply)}</td>
                    <td className="num">{daysLabel(r.daysSinceActivity)}</td>
                    <td>{r.nextAction ? `${r.nextAction.label}${r.nextAction.dueAt ? ` · ${formatShortDate(new Date(r.nextAction.dueAt))}` : ''}` : <span className="text-subtle">Yok</span>}</td>
                    <td>{r.owner ?? <span className="text-subtle">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
