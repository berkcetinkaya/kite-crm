// Öncelikli Fırsatlar on Ana Sayfa (Phase 14): at most 5 companies above Normal priority, skipping
// companies already in Bugün. Advisory only: the action links to where Berk does the step.
import { SalesStatusBadge } from '../../../components/sales/SalesStatusBadge';
import type { Dashboard } from '../../../domain/dashboard';
import { ActionLink, PriorityBadge, Reasons, type CompanySection } from '../../sales/intelligenceView';

export function FocusSection({ rows, onOpenCompany }: { rows: Dashboard['focus']; onOpenCompany: (id: string, section?: CompanySection) => void }) {
  return (
    <section className="card dash-card" id="dash-focus" aria-labelledby="dash-focus-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="dash-focus-title" className="card__title">
            Öncelikli Fırsatlar
          </h2>
          <p className="card__subtitle">Bugün listesindeki şirketler hariç · en fazla 5</p>
        </div>
        <div className="card__action">
          <a className="dash-link" href="#/pipeline">
            Tümünü Satış Süreci'nde gör
          </a>
        </div>
      </header>
      <div className="card__body card__body--flush">
        {rows.length === 0 ? (
          <p className="dash-empty">Şu an Bugün listesi dışında öne çıkan bir fırsat yok.</p>
        ) : (
          <ul className="focus-list">
            {rows.map((i) => (
              <li key={i.companyId} className="focus-list__item">
                <div className="focus-list__main">
                  <button type="button" className="link-cell" onClick={() => onOpenCompany(i.companyId)}>
                    {i.companyName}
                  </button>
                  <SalesStatusBadge status={i.stage} />
                  {i.priority && <PriorityBadge level={i.priority.level} />}
                </div>
                <div className="focus-list__action">
                  {i.action ? <ActionLink action={i.action} onOpenCompany={onOpenCompany} /> : <span className="text-subtle">Önerilen adım yok</span>}
                  <Reasons insight={i} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
