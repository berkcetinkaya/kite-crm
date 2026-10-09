// Öncelikli Fırsatlar (Phase 14): the ranked sales list on Satış Süreci, with plain diagnostics and
// filters. Read-only and advisory: rows open the company drawer; actions link to where the step is
// done. Nothing here changes a stage, sends, or creates a record.
import { useState } from 'react';
import { Filter } from 'lucide-react';
import { SalesStatusBadge } from '../../components/sales/SalesStatusBadge';
import { PROPOSAL_STATE_LABELS, type SalesInsight, type SalesIntelligence } from '../../domain/salesIntelligence';
import { SALES_STATUS } from '../../domain/salesStatus';
import { COOLING_DAYS } from '../../domain/businessDay';
import { activityText, ActionLink, MomentumBadge, PlannedLine, PriorityBadge, Reasons, type CompanySection } from '../sales/intelligenceView';

export const FOCUS_FILTERS = ['all', 'priority', 'stuck', 'proposal', 'replied', 'no_action'] as const;
export type FocusFilter = (typeof FOCUS_FILTERS)[number];
export const FOCUS_FILTER_LABELS: Record<FocusFilter, string> = {
  all: 'Tümü',
  priority: 'Öncelikli',
  stuck: 'Takılanlar',
  proposal: 'Teklif Bekleyen',
  replied: 'Yanıt Geldi',
  no_action: 'Aksiyon Yok',
};

export function matchesFocus(i: SalesInsight, f: FocusFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'priority':
      return i.priority?.level === 'critical' || i.priority?.level === 'high';
    case 'stuck':
      return i.momentum?.state === 'stuck';
    case 'proposal':
      return !!i.proposal && ['new', 'deciding', 'follow_up', 'expired'].includes(i.proposal.state) && i.proposal.days !== null;
    case 'replied':
      return i.stage === 'replied' || i.flags.some((x) => x.key === 'reply_no_action');
    case 'no_action':
      return i.flags.some((x) => x.key === 'no_next_action');
  }
}

export function DiagnosticsStrip({ d }: { d: SalesIntelligence['diagnostics'] }) {
  const open = Object.values(d.openByStage).reduce((n, v) => n + v, 0);
  const items: [string, number][] = [
    ['Açık fırsat', open],
    ['Takılan', d.stuck],
    ['Soğuyan', d.cooling],
    ['Sonraki adımı yok', d.noNextAction],
    [`${COOLING_DAYS}+ gündür hareketsiz`, d.noRecentActivity],
    ['Bekleyen teklif', d.proposalsWaiting],
    ['Yanıt var, görüşme yok', d.repliesWithoutMeeting],
    ['Görüşme var, teklif yok', d.meetingsWithoutProposal],
    ['Hazır, taslak yok', d.readyWithoutDraft],
  ];
  return (
    <section className="si-diagnostics" aria-label="Satış süreci durumu">
      <ul>
        {items.map(([label, n]) => (
          <li key={label} className={n > 0 && label !== 'Açık fırsat' ? 'si-diagnostics__item si-diagnostics__item--attention' : 'si-diagnostics__item'}>
            <strong>{n}</strong>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      <p className="si-diagnostics__stages">
        {Object.entries(d.openByStage)
          .map(([s, n]) => `${SALES_STATUS[s as keyof typeof SALES_STATUS].label} ${n}`)
          .join(' · ')}
      </p>
    </section>
  );
}

export function FocusTable({ data, onOpenCompany }: { data: SalesIntelligence; onOpenCompany: (companyId: string, section?: CompanySection) => void }) {
  const [filter, setFilter] = useState<FocusFilter>('all');
  const rows = data.insights.filter((i) => matchesFocus(i, filter));
  return (
    <section className="card si-focus" aria-labelledby="si-focus-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="si-focus-title" className="card__title">
            Öncelikli Fırsatlar
          </h2>
          <p className="card__subtitle">Öncelik, ivme ve önerilen adım kayıtlı verilerden hesaplanır; öneriler hiçbir şeyi kendiliğinden yapmaz.</p>
        </div>
      </header>
      <div className="card__body">
        <div className="si-filters">
          <Filter size={14} aria-hidden="true" />
          <div className="chip-row" role="group" aria-label="Fırsat filtresi">
            {FOCUS_FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? 'filter-chip filter-chip--on' : 'filter-chip'} onClick={() => setFilter(f)}>
                {FOCUS_FILTER_LABELS[f]}
                <span className="filter-chip__count">{data.insights.filter((i) => matchesFocus(i, f)).length}</span>
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="sales-hint">{data.insights.length === 0 ? 'Açık satış fırsatı yok.' : 'Bu filtrede fırsat yok.'}</p>
        ) : (
          <div className="si-table-wrap">
            <table className="si-table">
              <thead>
                <tr>
                  <th scope="col">Şirket</th>
                  <th scope="col">Aşama</th>
                  <th scope="col">Öncelik</th>
                  <th scope="col">İvme</th>
                  <th scope="col">Önerilen adım</th>
                  <th scope="col">Aşamada</th>
                  <th scope="col">Son hareket</th>
                  <th scope="col">Teklif</th>
                  <th scope="col">Sorumlu</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.companyId}>
                    <th scope="row">
                      <button type="button" className="si-company" onClick={() => onOpenCompany(i.companyId)}>
                        {i.companyName}
                      </button>
                    </th>
                    <td data-label="Aşama">
                      <SalesStatusBadge status={i.stage} />
                    </td>
                    <td>
                      {i.priority && <PriorityBadge level={i.priority.level} />}
                      <Reasons insight={i} />
                    </td>
                    <td data-label="İvme">{i.momentum ? <MomentumBadge state={i.momentum.state} /> : '—'}</td>
                    <td className="si-table__action" data-label="Önerilen adım">
                      {i.action ? <ActionLink action={i.action} onOpenCompany={onOpenCompany} compact /> : <span className="text-subtle">—</span>}
                      <PlannedLine planned={i.planned} />
                    </td>
                    <td data-label="Aşamada">{i.daysInStage === null ? '—' : i.daysInStage === 0 ? 'bugün' : `${i.daysInStage} gün`}</td>
                    <td data-label="Son hareket">{activityText(i)}</td>
                    <td data-label="Teklif">{i.proposal ? PROPOSAL_STATE_LABELS[i.proposal.state] : '—'}</td>
                    <td data-label="Sorumlu">{i.owner ?? <span className="text-subtle">Atanmadı</span>}</td>
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
