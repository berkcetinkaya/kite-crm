import { useId, useState, type KeyboardEvent } from 'react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import type { ActivityTabId, CompanyRow } from '../../../lib/types';

interface ActivityTabsProps {
  tabs: { id: ActivityTabId; label: string }[];
  rows: Record<ActivityTabId, CompanyRow[]>;
}

function scoreTier(score: number): 'high' | 'mid' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 60) return 'mid';
  return 'low';
}

export function ActivityTabs({ tabs, rows }: ActivityTabsProps) {
  const [active, setActive] = useState<ActivityTabId>('research');
  const baseId = useId();
  const current = rows[active];

  // Arrow-key navigation per the WAI-ARIA tabs pattern.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    setActive(next.id);
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
  };

  return (
    <Card flush className="activity-card">
      <div className="tabs" role="tablist" aria-label="Aktivite">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`${baseId}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={active === t.id ? 0 : -1}
            className={active === t.id ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
            <span className="tabs__count">{rows[t.id].length}</span>
          </button>
        ))}
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${active}`} className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">
                Şirket <span className="table__header-sub">· Sektör · Şehir</span>
              </th>
              <th scope="col">Önerilen Hizmet</th>
              <th scope="col">Fırsat Skoru</th>
              <th scope="col">Son Durum</th>
              <th scope="col">Sonraki Adım</th>
            </tr>
          </thead>
          <tbody>
            {current.map((r) => (
              <tr key={r.id}>
                <td className="table__strong">
                  {r.company}
                  <span className="table__sub">
                    {r.sector} · {r.city}
                  </span>
                </td>
                <td>
                  <span className="service-tag">{r.service}</span>
                </td>
                <td>
                  <span className={`score score--${scoreTier(r.opportunityScore)}`}>
                    <span className="score__value">{r.opportunityScore}</span>
                    <span className="score__track" aria-hidden="true">
                      <span style={{ width: `${r.opportunityScore}%` }} />
                    </span>
                  </span>
                </td>
                <td>
                  <Badge tone={r.statusTone} dot>
                    {r.status}
                  </Badge>
                </td>
                <td className="table__muted table__wrap">{r.nextStep}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
