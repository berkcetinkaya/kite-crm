// Teklif Durumu, Müşteri Operasyonu, Takip and Görüşmeler. Amounts are reference values from proposal
// items: one line per currency, one-time and monthly always separate, no conversion, no totals.
import { CalendarClock, CalendarDays } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { CUSTOMER_STATUS_LABELS } from '../../../domain/customers';
import { DASHBOARD_RANGE_LABELS, type Dashboard, type MeetingRow, type PipelineValue } from '../../../domain/dashboard';
import { formatMoney, MEETING_TYPE_LABELS, PROPOSAL_STATUS_LABELS, PROPOSAL_STATUSES } from '../../../domain/sales';
import { formatShortDate, formatTime } from '../../../lib/date';
import { customerHref, CUSTOMER_TONE, ProgressBar } from '../../customers/customersView';
import { MAIL_ROUTE } from '../../mail/routes';
import { PROPOSAL_TONE } from '../../sales/salesView';
import { PROPOSALS_ROUTE } from '../dashboardView';

function ValueLines({ value, empty }: { value: PipelineValue; empty: string }) {
  if (value.proposals === 0) return <p className="dash-empty dash-empty--inline">{empty}</p>;
  if (value.byCurrency.length === 0) return <p className="dash-empty dash-empty--inline">{value.proposals} teklif · tutar girilmemiş</p>;
  return (
    <ul className="value-lines">
      {value.byCurrency.map((v) => (
        <li key={v.currency}>
          <span className="value-lines__cur">{v.currency}</span>
          <span className="value-lines__amounts">
            {v.monthlyMinor > 0 && <span>{formatMoney(v.monthlyMinor, v.currency)} / ay</span>}
            {v.oneTimeMinor > 0 && <span>{formatMoney(v.oneTimeMinor, v.currency)} tek seferlik</span>}
          </span>
          <span className="value-lines__meta">
            {v.proposals} teklif{v.taxMixed ? ' · KDV durumu karışık' : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ProposalStatusCard({ dashboard }: { dashboard: Dashboard }) {
  const p = dashboard.proposals;
  const total = PROPOSAL_STATUSES.reduce((n, s) => n + p.statusCounts[s], 0);
  return (
    <section className="card dash-card" aria-labelledby="dash-proposals">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="dash-proposals" className="card__title">
            Teklif Durumu
          </h2>
          <p className="card__subtitle">{total ? `${total} teklif` : 'Henüz teklif yok'}</p>
        </div>
        <a className="dash-link" href={PROPOSALS_ROUTE}>
          Teklifler
        </a>
      </header>
      <div className="card__body">
        <ul className="chip-row">
          {PROPOSAL_STATUSES.map((s) => (
            <li key={s} className={p.statusCounts[s] ? 'count-chip' : 'count-chip count-chip--zero'}>
              <Badge tone={PROPOSAL_TONE[s]}>{PROPOSAL_STATUS_LABELS[s]}</Badge> <strong>{p.statusCounts[s]}</strong>
            </li>
          ))}
        </ul>
        <div className="value-block">
          <p className="dash-subhead">Karar bekleyen (Gönderildi)</p>
          <ValueLines value={p.awaitingDecision} empty="Karar bekleyen teklif yok." />
        </div>
        <div className="value-block">
          <p className="dash-subhead">
            Kabul edilen · {DASHBOARD_RANGE_LABELS[dashboard.range.key]} <span className="dash-tag">Seçili dönem</span>
          </p>
          <ValueLines value={p.acceptedInRange} empty="Bu dönemde kabul edilen teklif yok." />
        </div>
        <p className="dash-hint">Teklif kalemlerindeki tutarlar referanstır; kur çevrimi, toplam gelir veya tahmin yapılmaz.</p>
      </div>
    </section>
  );
}

export function CustomerOpsCard({ customers }: { customers: Dashboard['customers'] }) {
  const total = Object.values(customers.statusCounts).reduce((n, v) => n + v, 0);
  const flags: [string, number, 'danger' | 'warning' | 'neutral' | 'success'][] = [
    ['Engel Var', customers.blocked, 'danger'],
    ['Gecikmiş adım', customers.overdueItems, 'warning'],
    ['Erişim sorunu', customers.accessProblems, 'danger'],
    ['Aktif hizmet', customers.activeServices, 'success'],
    ['Sonraki adımı yok', customers.noNextAction, 'neutral'],
  ];
  return (
    <section className="card dash-card" aria-labelledby="dash-customers">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="dash-customers" className="card__title">
            Müşteri Operasyonu
          </h2>
          <p className="card__subtitle">{total ? `${total} müşteri kaydı` : 'Henüz müşteri kaydı yok'}</p>
        </div>
        <a className="dash-link" href="#/clients">
          Müşteriler
        </a>
      </header>
      <div className="card__body">
        {total === 0 ? (
          <p className="dash-empty">Müşteri kaydı yok. Kabul edilen bir tekliften onboarding başlatıldığında burada görünür.</p>
        ) : (
          <>
            <ul className="chip-row">
              {(['onboarding', 'active', 'on_hold'] as const).map((s) => (
                <li key={s} className={customers.statusCounts[s] ? 'count-chip' : 'count-chip count-chip--zero'}>
                  <Badge tone={CUSTOMER_TONE[s]}>{CUSTOMER_STATUS_LABELS[s]}</Badge> <strong>{customers.statusCounts[s]}</strong>
                </li>
              ))}
            </ul>
            <ul className="chip-row">
              {flags.map(([label, value, tone]) => (
                <li key={label} className={value ? `flag-chip flag-chip--${tone}` : 'flag-chip flag-chip--zero'}>
                  {label} <strong>{value}</strong>
                </li>
              ))}
            </ul>
            {customers.onboarding.length > 0 && (
              <>
                <p className="dash-subhead">Onboarding</p>
                <ul className="onb-rows">
                  {customers.onboarding.map((o) => (
                    <li key={o.customerId}>
                      <a className="onb-row" href={customerHref(o.customerId)}>
                        <span className="onb-row__name">{o.name}</span>
                        <ProgressBar done={o.done} total={o.total} />
                        <span className="onb-row__meta">{o.daysSinceStart} gündür</span>
                        {o.blocked && <Badge tone="danger">Engel Var</Badge>}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function FollowUpCard({ followUps }: { followUps: Dashboard['followUps'] }) {
  const rows: [string, number][] = [
    ['Takip zamanı geldi', followUps.due],
    ['Taslak hazır', followUps.prepared],
    ['Onaylandı, gönderilmedi', followUps.approved],
    ['Yaklaşan', followUps.upcoming],
    ['Dikkat gerekiyor', followUps.attention],
  ];
  const total = rows.reduce((n, [, v]) => n + v, 0);
  return (
    <section className="card dash-card" aria-labelledby="dash-followups">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="dash-followups" className="card__title">
            Takip
          </h2>
          <p className="card__subtitle">{total ? 'Açık takip planları' : 'Açık takip planı yok'}</p>
        </div>
        <a className="dash-link" href={MAIL_ROUTE}>
          Mail &amp; Takip
        </a>
      </header>
      <div className="card__body">
        <dl className="kv-list">
          {rows.map(([label, value]) => (
            <div key={label} className={value ? (label === 'Takip zamanı geldi' ? 'kv kv--hot' : 'kv') : 'kv kv--zero'}>
              <dt>
                <CalendarClock size={14} aria-hidden="true" /> {label}
              </dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="dash-hint">KITE takip maili göndermez veya üretmez; hazırlama ve onay Mail &amp; Takip'te yapılır.</p>
      </div>
    </section>
  );
}

function MeetingList({ title, rows, onOpenCompany, past }: { title: string; rows: MeetingRow[]; onOpenCompany: (id: string) => void; past?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <>
      <p className={past ? 'dash-subhead dash-subhead--warn' : 'dash-subhead'}>{title}</p>
      <ul className="meet-rows">
        {rows.map((m) => (
          <li key={m.meetingId}>
            <button type="button" className="meet-row" onClick={() => onOpenCompany(m.companyId)}>
              <span className="meet-row__time">
                {formatShortDate(new Date(m.scheduledAt))} {formatTime(new Date(m.scheduledAt))}
              </span>
              <span className="meet-row__main">
                {m.companyName}
                <span className="meet-row__meta">
                  {MEETING_TYPE_LABELS[m.type]}
                  {m.contactName ? ` · ${m.contactName}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function MeetingsCard({ meetings, onOpenCompany }: { meetings: Dashboard['meetings']; onOpenCompany: (id: string) => void }) {
  const none = meetings.today.length + meetings.overdueWithoutOutcome.length + meetings.upcoming.length === 0;
  return (
    <section className="card dash-card" aria-labelledby="dash-meetings">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="dash-meetings" className="card__title">
            Görüşmeler
          </h2>
          <p className="card__subtitle">Bugün ve önümüzdeki 7 gün</p>
        </div>
      </header>
      <div className="card__body">
        {none ? (
          <p className="dash-empty">
            <CalendarDays size={16} aria-hidden="true" /> Planlı görüşme yok.
          </p>
        ) : (
          <>
            <MeetingList title="Sonucu girilmemiş" rows={meetings.overdueWithoutOutcome} onOpenCompany={onOpenCompany} past />
            <MeetingList title="Bugün" rows={meetings.today} onOpenCompany={onOpenCompany} />
            <MeetingList title="Önümüzdeki 7 gün" rows={meetings.upcoming} onOpenCompany={onOpenCompany} />
          </>
        )}
      </div>
    </section>
  );
}

