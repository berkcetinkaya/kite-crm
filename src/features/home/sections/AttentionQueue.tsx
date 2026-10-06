// "Bugün": the unified attention queue (current state, independent of the selected range). Rows are
// computed by the server and already deduplicated and ordered by severity.
import { useState } from 'react';
import { ChevronRight, CircleCheck } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { ATTENTION_KIND_LABELS, SEVERITY_LABELS, type AttentionItem, type AttentionSeverity } from '../../../domain/dashboard';
import { ageLabel, DashLink } from '../dashboardView';

const TONE: Record<AttentionSeverity, BadgeTone> = { 1: 'danger', 2: 'warning', 3: 'neutral' };
const VISIBLE = 12;

export function AttentionQueue({ items, onOpenCompany }: { items: AttentionItem[]; onOpenCompany: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, VISIBLE);
  const critical = items.filter((i) => i.severity === 1).length;
  return (
    <section className="card dash-card" aria-labelledby="dash-today">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="dash-today" className="card__title">
            Bugün
          </h2>
          <p className="card__subtitle">{items.length ? `${items.length} iş${critical ? ` · ${critical} kritik` : ''}` : 'Dikkat gerektiren iş yok'}</p>
        </div>
      </header>
      <div className="card__body card__body--flush">
        {items.length === 0 ? (
          <p className="dash-empty">
            <CircleCheck size={16} aria-hidden="true" /> Bugün acil iş yok. Gecikmiş adım, takip, görüşme, teklif veya müşteri engeli bulunmuyor.
          </p>
        ) : (
          <ul className="attn-list">
            {shown.map((a) => (
              <li key={a.key}>
                <DashLink link={a.link} onOpenCompany={onOpenCompany} className={`attn-row attn-row--s${a.severity}`} label={`${ATTENTION_KIND_LABELS[a.kind]}: ${a.companyName}. ${a.description}`}>
                  <Badge tone={TONE[a.severity]}>{SEVERITY_LABELS[a.severity]}</Badge>
                  <span className="attn-row__main">
                    <span className="attn-row__title">
                      <span className="attn-row__kind">{ATTENTION_KIND_LABELS[a.kind]}</span> · {a.companyName}
                    </span>
                    <span className="attn-row__desc">{a.description}</span>
                  </span>
                  <span className="attn-row__meta">
                    <span className={a.severity === 1 ? 'attn-row__age attn-row__age--late' : 'attn-row__age'}>{ageLabel(a)}</span>
                    {a.owner && <span className="attn-row__owner">{a.owner}</span>}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" className="attn-row__chev" />
                </DashLink>
              </li>
            ))}
          </ul>
        )}
        {items.length > VISIBLE && (
          <button type="button" className="dash-more" onClick={() => setAll((v) => !v)}>
            {all ? 'Daha az göster' : `Tümünü göster (${items.length})`}
          </button>
        )}
      </div>
    </section>
  );
}
