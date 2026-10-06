// "Müşteri onboarding'ini başlat" (Phase 9). Berk chooses everything explicitly: services (prefilled
// as editable copies of an accepted proposal's items), checklist items and access requirements.
// The company must be at Müşteri; otherwise moving it is an unticked checkbox that must be ticked.
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { errorMessage } from '../../api/dataApi';
import { useToast } from '../../components/ui/Toast';
import type { Company } from '../../domain/company';
import {
  ACCESS_KIND_LABELS,
  ACCESS_KINDS,
  containsSecret,
  NO_SECRETS_WARNING,
  suggestedAccess,
  suggestedOnboarding,
  type AccessKind,
  type Customer,
  type CustomerServiceInput,
} from '../../domain/customers';
import { BILLING_TYPE_LABELS, formatMoney, PROPOSAL_STATUS_LABELS } from '../../domain/sales';
import { SALES_STATUS } from '../../domain/salesStatus';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../domain/services';
import { formatShortDate, fromDateInputValue, toDateInputValue } from '../../lib/date';
import { useCustomers } from '../../state/customers/CustomersProvider';
import { useSales } from '../../state/sales/SalesProvider';
import { NoSecretsNotice } from './customersView';

interface ServiceRow extends CustomerServiceInput {
  key: string;
  include: boolean;
}

const manualService = (service: ServiceKey, n: number): ServiceRow => ({
  key: `manual_${n}`,
  include: true,
  service,
  label: '',
  billingType: null,
  amountMinor: null,
  currency: null,
  sourceProposalId: null,
  sourceItemId: null,
  notes: '',
  startDate: null,
  endDate: null,
});

export function StartOnboarding({ company, proposalId, onStarted, onCancel }: { company: Company; proposalId: string | null; onStarted: (c: Customer) => void; onCancel: () => void }) {
  const { proposalsFor } = useSales();
  const { run } = useCustomers();
  const showToast = useToast();
  const accepted = proposalsFor(company.id).filter((p) => p.status === 'accepted');
  const [sourceId, setSourceId] = useState<string>(() => (proposalId && accepted.some((p) => p.id === proposalId) ? proposalId : (accepted[0]?.id ?? '')));
  const source = accepted.find((p) => p.id === sourceId) ?? null;

  const fromProposal = (id: string): ServiceRow[] => {
    const p = accepted.find((x) => x.id === id);
    return (p?.items ?? []).map((i) => ({
      key: i.id,
      include: true,
      service: i.service,
      label: '',
      billingType: i.billingType,
      amountMinor: i.unitAmountMinor * i.quantity,
      currency: p!.currency,
      sourceProposalId: p!.id,
      sourceItemId: i.id,
      notes: i.description,
      startDate: null,
      endDate: null,
    }));
  };
  const [services, setServices] = useState<ServiceRow[]>(() => fromProposal(sourceId));
  const [manualCount, setManualCount] = useState(0);
  const chosenServices = services.filter((s) => s.include).map((s) => s.service);

  const templates = useMemo(() => suggestedOnboarding(chosenServices), [chosenServices.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const accessSuggestions = useMemo(() => suggestedAccess(chosenServices), [chosenServices.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  // Unchecked keys are remembered; everything suggested starts checked (Berk can untick).
  const [skipItems, setSkipItems] = useState<Set<string>>(new Set());
  const [extraItems, setExtraItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState('');
  const [skipAccess, setSkipAccess] = useState<Set<AccessKind>>(new Set());
  const [extraAccess, setExtraAccess] = useState<AccessKind[]>([]);

  const [startDate, setStartDate] = useState(toDateInputValue(new Date().toISOString()));
  const [contactId, setContactId] = useState<string>(company.contacts.find((c) => c.isDecisionMaker)?.id ?? company.contacts[0]?.id ?? '');
  const [commercialNotes, setCommercialNotes] = useState(() => (source?.contractMonths ? `Sözleşme: ${source.contractMonths} ay` : ''));
  const [operationalNotes, setOperationalNotes] = useState('');
  const [moveToClient, setMoveToClient] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsMove = company.status !== 'client';

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  const patchService = (key: string, patch: Partial<ServiceRow>) => setServices((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const submit = async () => {
    if (needsMove && !moveToClient) return setError(`Şirket ${SALES_STATUS[company.status].label} aşamasında. Önce “Şirketi Müşteri aşamasına taşı” kutusunu işaretle.`);
    const date = fromDateInputValue(startDate);
    if (!date) return setError('Başlangıç tarihini seç.');
    const included = services.filter((s) => s.include);
    if ([commercialNotes, operationalNotes, ...included.flatMap((s) => [s.label, s.notes])].some(containsSecret)) return setError(`Notlarda şifre veya anahtar görünüyor. ${NO_SECRETS_WARNING}`);
    setBusy(true);
    setError(null);
    try {
      const customer = await run((api) =>
        api.start(company.id, {
          startDate: date,
          primaryContactId: contactId || null,
          commercialNotes,
          operationalNotes,
          sourceProposalId: source?.id ?? null,
          services: included.map(({ key: _k, include: _i, ...s }) => ({ ...s, label: s.label.trim(), notes: s.notes.trim() })),
          onboardingItems: [...templates.filter((t) => !skipItems.has(t.key)).map((t) => ({ label: t.label, templateKey: t.key, dueDate: null, notes: '' })), ...extraItems.map((label) => ({ label, templateKey: null, dueDate: null, notes: '' }))],
          accessItems: [...accessSuggestions.filter((k) => !skipAccess.has(k)), ...extraAccess].map((kind) => ({ kind, label: '', notes: '' })),
          moveCompanyToClient: needsMove && moveToClient,
        }),
      );
      showToast({ title: 'Onboarding başlatıldı', description: `${company.name} · Onboarding` });
      onStarted(customer);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="sales-form start-onb" aria-label={`${company.name} için onboarding başlat`}>
      {needsMove ? (
        <div className="stage-move">
          <p className="sales-hint sales-hint--warn">
            Şirket şu an <strong>{SALES_STATUS[company.status].label}</strong> aşamasında. Müşteri kaydı yalnızca Müşteri aşamasındaki şirketler için açılır.
          </p>
          <label className="stage-move__check">
            <input type="checkbox" checked={moveToClient} onChange={(e) => setMoveToClient(e.target.checked)} />
            <span>Şirketi Müşteri aşamasına taşı</span>
          </label>
        </div>
      ) : null}

      <fieldset className="start-onb__group">
        <legend className="field__label">Kabul edilen teklif</legend>
        {accepted.length === 0 ? (
          <p className="sales-hint">Kabul edilmiş teklif yok; hizmetleri aşağıdan elle ekleyebilirsin.</p>
        ) : (
          <select
            className="input"
            aria-label="Kabul edilen teklif"
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setServices((list) => [...fromProposal(e.target.value), ...list.filter((s) => s.sourceItemId === null)]);
            }}
          >
            <option value="">Teklifsiz başlat</option>
            {accepted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {PROPOSAL_STATUS_LABELS[p.status]}
                {p.decidedAt ? ` ${formatShortDate(new Date(p.decidedAt))}` : ''}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      <fieldset className="start-onb__group">
        <legend className="field__label">Hizmetler</legend>
        <p className="sales-hint">Teklif kalemleri düzenlenebilir kopyalar olarak gelir; tutar yalnızca referanstır (fatura değildir). Hizmetler “Hazırlanıyor” olarak açılır.</p>
        {services.length === 0 && <p className="sales-hint">Henüz hizmet yok.</p>}
        <ul className="start-onb__list">
          {services.map((s) => (
            <li key={s.key} className="start-onb__service">
              <label className="stage-move__check">
                <input type="checkbox" checked={s.include} onChange={(e) => patchService(s.key, { include: e.target.checked })} />
                <span>
                  <strong>{SERVICES[s.service].label}</strong>
                  {s.amountMinor !== null && s.currency && s.billingType && (
                    <span className="sales-hint">
                      {' '}
                      · {formatMoney(s.amountMinor, s.currency)} {BILLING_TYPE_LABELS[s.billingType].toLowerCase()}
                    </span>
                  )}
                </span>
              </label>
              {s.sourceItemId === null && (
                <select className="input" aria-label="Hizmet türü" value={s.service} onChange={(e) => patchService(s.key, { service: e.target.value as ServiceKey })}>
                  {SERVICE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {SERVICES[k].label}
                    </option>
                  ))}
                </select>
              )}
              <input className="input" aria-label={`${SERVICES[s.service].label} kapsamı`} placeholder="Kapsam (ör. Türkiye, Gulf) — isteğe bağlı" maxLength={120} value={s.label} onChange={(e) => patchService(s.key, { label: e.target.value })} />
              {s.sourceItemId === null && (
                <button type="button" className="button button--ghost button--sm" aria-label="Hizmeti kaldır" onClick={() => setServices((l) => l.filter((x) => x.key !== s.key))}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={() => {
            setServices((l) => [...l, manualService('meta_ads', manualCount + 1)]);
            setManualCount((n) => n + 1);
          }}
        >
          <Plus size={14} aria-hidden="true" /> Hizmet ekle
        </button>
      </fieldset>

      <div className="sales-form__grid">
        <label className="field">
          <span className="field__label">Başlangıç tarihi</span>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Ana iletişim kişisi</span>
          <select className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Seçilmedi</option>
            {company.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
                {c.email ? ` · ${c.email}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="start-onb__group">
        <legend className="field__label">Onboarding adımları</legend>
        <p className="sales-hint">Seçilen hizmetlere göre öneriler. İstemediklerini kaldır; sonradan da ekleyip düzenleyebilirsin.</p>
        <ul className="start-onb__checks">
          {templates.map((t) => (
            <li key={t.key}>
              <label className="stage-move__check">
                <input type="checkbox" checked={!skipItems.has(t.key)} onChange={() => setSkipItems((s) => toggle(s, t.key))} />
                <span>{t.label}</span>
              </label>
            </li>
          ))}
          {extraItems.map((label, i) => (
            <li key={`extra_${i}`}>
              <label className="stage-move__check">
                <input type="checkbox" checked onChange={() => setExtraItems((l) => l.filter((_, j) => j !== i))} />
                <span>{label}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="start-onb__add">
          <input className="input" aria-label="Özel onboarding adımı" placeholder="Özel adım ekle" maxLength={200} value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <button
            type="button"
            className="button button--ghost button--sm"
            disabled={!newItem.trim()}
            onClick={() => {
              setExtraItems((l) => [...l, newItem.trim()]);
              setNewItem('');
            }}
          >
            <Plus size={14} aria-hidden="true" /> Ekle
          </button>
        </div>
      </fieldset>

      <fieldset className="start-onb__group">
        <legend className="field__label">Erişim gereksinimleri</legend>
        <NoSecretsNotice />
        <ul className="start-onb__checks">
          {[...accessSuggestions, ...extraAccess].map((k, i) => (
            <li key={`${k}_${i}`}>
              <label className="stage-move__check">
                <input
                  type="checkbox"
                  checked={i < accessSuggestions.length ? !skipAccess.has(k) : true}
                  onChange={() => (i < accessSuggestions.length ? setSkipAccess((s) => toggle(s, k)) : setExtraAccess((l) => l.filter((_, j) => j !== i - accessSuggestions.length)))}
                />
                <span>{ACCESS_KIND_LABELS[k]}</span>
              </label>
            </li>
          ))}
        </ul>
        <select className="input start-onb__narrow" aria-label="Erişim ekle" value="" onChange={(e) => e.target.value && setExtraAccess((l) => [...l, e.target.value as AccessKind])}>
          <option value="">Erişim ekle…</option>
          {ACCESS_KINDS.map((k) => (
            <option key={k} value={k}>
              {ACCESS_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </fieldset>

      <label className="field">
        <span className="field__label">Ticari notlar</span>
        <textarea className="input textarea" rows={2} maxLength={4000} value={commercialNotes} onChange={(e) => setCommercialNotes(e.target.value)} placeholder="ör. 6 ay sözleşme, aylık rapor" />
      </label>
      <label className="field">
        <span className="field__label">Operasyon notları</span>
        <textarea className="input textarea" rows={2} maxLength={4000} value={operationalNotes} onChange={(e) => setOperationalNotes(e.target.value)} placeholder="ör. Raporlar her pazartesi" />
      </label>

      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy || (needsMove && !moveToClient)}>
          Onboarding'i başlat
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>
          Vazgeç
        </button>
      </div>
      <p className="sales-hint">Müşteri “Onboarding” durumunda açılır. Aktifleştirme, hizmet başlatma ve erişim takibi ayrı ve elle yapılır.</p>
    </div>
  );
}
