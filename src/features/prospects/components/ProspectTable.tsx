import type { Company, NextAction } from '../../../domain/company';
import { OpportunityScore } from '../../../components/sales/OpportunityScore';
import { OpportunitySummary } from '../../../components/sales/OpportunitySummary';
import { SalesStatusBadge } from '../../../components/sales/SalesStatusBadge';
import { dayDiff, formatDue, formatRelativePast } from '../../../lib/date';
import { formatLocationCompact } from '../../../domain/locations';
import { companySectorLabel } from '../query';

interface ProspectTableProps {
  companies: Company[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('tr-TR'))
    .join('');
}

function NextActionCell({ action, now }: { action: NextAction | null; now: Date }) {
  if (!action) return <span className="text-subtle">—</span>;
  const due = action.dueAt ? new Date(action.dueAt) : null;
  const overdue = due !== null && dayDiff(now, due) < 0;
  return (
    <span className="next-action">
      <span className="next-action__label">{action.label}</span>
      {due && (
        <span className={overdue ? 'next-action__due next-action__due--overdue' : 'next-action__due'}>
          {formatDue(due, now)}
        </span>
      )}
    </span>
  );
}

/**
 * Dense prospect list. The company name is a real button (keyboard + screen readers); the whole
 * row is also clickable for mouse users. Secondary columns hide at narrower widths (see CSS).
 */
export function ProspectTable({ companies, selectedId, onOpen }: ProspectTableProps) {
  const now = new Date();
  return (
    <table className="prospect-table">
      <thead>
        <tr>
          <th scope="col">Şirket</th>
          <th scope="col">Hizmet Fırsatı</th>
          <th scope="col">Fırsat Skoru</th>
          <th scope="col">Durum</th>
          <th scope="col" className="col-last-contact">
            Son Temas
          </th>
          <th scope="col" className="col-next">
            Sonraki Adım
          </th>
          <th scope="col" className="col-owner">
            Sorumlu
          </th>
        </tr>
      </thead>
      <tbody>
        {companies.map((c) => (
          <tr
            key={c.id}
            className={c.id === selectedId ? 'prospect-row prospect-row--selected' : 'prospect-row'}
            onClick={() => onOpen(c.id)}
          >
            <td className="cell-company">
              <button
                type="button"
                className="prospect-row__name"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(c.id);
                }}
              >
                {c.name}
              </button>
              <span className="prospect-row__meta">
                {[companySectorLabel(c), formatLocationCompact(c.city, c.country)].filter(Boolean).join(' · ')}
              </span>
            </td>
            <td className="cell-service">
              <OpportunitySummary opportunities={c.opportunities} />
            </td>
            <td className="cell-score">
              <OpportunityScore score={c.opportunityScore} />
            </td>
            <td className="cell-status">
              <SalesStatusBadge status={c.status} />
            </td>
            <td className="col-last-contact text-muted">
              {c.lastContactAt ? formatRelativePast(new Date(c.lastContactAt), now) : <span className="text-subtle">—</span>}
            </td>
            <td className="col-next">
              <NextActionCell action={c.nextAction} now={now} />
            </td>
            <td className="col-owner">
              {c.owner ? (
                <span className="owner">
                  <span className="owner__avatar" aria-hidden="true">
                    {initials(c.owner)}
                  </span>
                  <span className="owner__name" title={c.owner}>
                    {c.owner.split(' ')[0]}
                  </span>
                </span>
              ) : (
                <span className="text-subtle">Atanmadı</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
