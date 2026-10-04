import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { FormField, fieldA11y } from '../../../components/ui/FormField';
import { useToast } from '../../../components/ui/Toast';
import { OpportunityScore } from '../../../components/sales/OpportunityScore';
import {
  POTENTIAL_LEVELS,
  POTENTIAL_ORDER,
  sortOpportunities,
  type Company,
  type PotentialLevel,
  type ServiceOpportunity,
} from '../../../domain/company';
import { isValidScore } from '../../../domain/score';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../../domain/services';
import { useCompanies } from '../../../state/companies/CompaniesProvider';

const POTENTIAL_TONE = { high: 'accent', medium: 'neutral', low: 'neutral' } as const;

export function OpportunitiesSection({ company }: { company: Company }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <OpportunitiesForm company={company} onDone={() => setEditing(false)} />;

  const list = sortOpportunities(company.opportunities);
  return (
    <div className="detail-section">
      <div className="detail-section__header">
        <h3 className="detail-section__title">Hizmet Fırsatları</h3>
        <button type="button" className="button button--secondary button--sm" onClick={() => setEditing(true)}>
          <Pencil size={14} aria-hidden="true" />
          {list.length ? 'Düzenle' : 'Fırsat Ekle'}
        </button>
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Henüz hizmet fırsatı yok"
          description="Bu şirket için hangi KITE hizmetlerinin uygun olduğunu ekle."
        />
      ) : (
        <ul className="opportunity-list">
          {list.map((o) => (
            <li key={o.service} className="opportunity">
              <div className="opportunity__top">
                <span className="opportunity__service">{SERVICES[o.service].label}</span>
                <OpportunityScore score={o.score} />
              </div>
              <p className={o.reason ? 'opportunity__reason' : 'opportunity__reason text-subtle'}>
                {o.reason || 'Gerekçe eklenmedi.'}
              </p>
              {o.potential ? (
                <Badge tone={POTENTIAL_TONE[o.potential]}>{POTENTIAL_LEVELS[o.potential]}</Badge>
              ) : (
                <Badge>Potansiyel belirlenmedi</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Row {
  service: ServiceKey;
  score: string;
  reason: string;
  potential: PotentialLevel | '';
}

const toRow = (o: ServiceOpportunity): Row => ({
  service: o.service,
  score: o.score === null ? '' : String(o.score),
  reason: o.reason,
  potential: o.potential ?? '',
});

function OpportunitiesForm({ company, onDone }: { company: Company; onDone: () => void }) {
  const { setOpportunities } = useCompanies();
  const showToast = useToast();
  const [rows, setRows] = useState<Row[]>(() => sortOpportunities(company.opportunities).map(toRow));
  const [errors, setErrors] = useState<Partial<Record<ServiceKey, string>>>({});
  const available = SERVICE_KEYS.filter((s) => !rows.some((r) => r.service === s));
  const [toAdd, setToAdd] = useState<ServiceKey | ''>('');
  const idp = `opp-${company.id}`;

  const patch = (service: ServiceKey, change: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.service === service ? { ...r, ...change } : r)));

  const addRow = () => {
    const service = toAdd || available[0];
    if (!service) return;
    setRows((list) => [...list, { service, score: '', reason: '', potential: '' }]);
    setToAdd('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found: Partial<Record<ServiceKey, string>> = {};
    for (const r of rows) {
      if (r.score.trim() && !isValidScore(Number(r.score))) found[r.service] = '0 ile 100 arasında tam sayı gir.';
    }
    setErrors(found);
    const first = rows.find((r) => found[r.service]);
    if (first) {
      document.getElementById(`${idp}-${first.service}-score`)?.focus();
      return;
    }
    setOpportunities(
      company.id,
      rows.map((r) => ({
        service: r.service,
        score: r.score.trim() ? Number(r.score) : null,
        reason: r.reason.trim(),
        potential: r.potential || null,
      })),
    );
    showToast({ title: 'Fırsatlar kaydedildi', description: company.name });
    onDone();
  };

  return (
    <form className="detail-section" onSubmit={onSubmit} noValidate>
      <div className="detail-section__header">
        <h3 className="detail-section__title">Hizmet Fırsatlarını Düzenle</h3>
      </div>
      {rows.length === 0 && <p className="text-muted">Henüz fırsat yok. Aşağıdan hizmet ekleyebilirsin.</p>}
      <ul className="opportunity-list">
        {rows.map((r) => (
          <li key={r.service} className="opportunity opportunity--editing">
            <div className="opportunity__top">
              <span className="opportunity__service">{SERVICES[r.service].label}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setRows((list) => list.filter((x) => x.service !== r.service))}
                aria-label={`${SERVICES[r.service].label} fırsatını kaldır`}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="form-grid">
              <FormField id={`${idp}-${r.service}-score`} label="Skor" error={errors[r.service]}>
                <input
                  {...fieldA11y(`${idp}-${r.service}-score`, errors[r.service])}
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={r.score}
                  onChange={(e) => patch(r.service, { score: e.target.value })}
                />
              </FormField>
              <FormField id={`${idp}-${r.service}-potential`} label="Potansiyel">
                <select
                  id={`${idp}-${r.service}-potential`}
                  className="input"
                  value={r.potential}
                  onChange={(e) => patch(r.service, { potential: e.target.value as PotentialLevel | '' })}
                >
                  <option value="">Belirlenmedi</option>
                  {POTENTIAL_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {POTENTIAL_LEVELS[p]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id={`${idp}-${r.service}-reason`} label="Kısa Gerekçe" className="form-grid__full">
                <textarea
                  id={`${idp}-${r.service}-reason`}
                  className="input textarea"
                  rows={2}
                  value={r.reason}
                  onChange={(e) => patch(r.service, { reason: e.target.value })}
                />
              </FormField>
            </div>
          </li>
        ))}
      </ul>
      {available.length > 0 && (
        <div className="inline-add">
          <label className="visually-hidden" htmlFor={`${idp}-add`}>
            Eklenecek hizmet
          </label>
          <select id={`${idp}-add`} className="input" value={toAdd || available[0]} onChange={(e) => setToAdd(e.target.value as ServiceKey)}>
            {available.map((s) => (
              <option key={s} value={s}>
                {SERVICES[s].label}
              </option>
            ))}
          </select>
          <button type="button" className="button button--secondary" onClick={addRow}>
            <Plus size={16} aria-hidden="true" />
            Fırsat Ekle
          </button>
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="button button--secondary" onClick={onDone}>
          Vazgeç
        </button>
        <button type="submit" className="button button--primary">
          Kaydet
        </button>
      </div>
    </form>
  );
}
