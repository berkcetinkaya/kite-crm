// Teklif editörü (Phase 8): title, currency, contract, validity, tax metadata and line items with
// one-time and monthly amounts kept apart. A service that is not yet an opportunity of the company is
// added as one only when Berk ticks "Bu hizmeti opportunity olarak da ekle". Nothing is sent.
import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { errorMessage } from '../../api/dataApi';
import type { Company } from '../../domain/company';
import {
  BILLING_TYPE_LABELS,
  BILLING_TYPES,
  CURRENCIES,
  formatMoney,
  MAX_CONTRACT_MONTHS,
  MAX_PROPOSAL_ITEMS,
  minorToInput,
  parseAmountToMinor,
  proposalTotals,
  TAX_MODE_LABELS,
  TAX_MODES,
  type BillingType,
  type Currency,
  type Proposal,
  type ProposalInput,
  type TaxMode,
} from '../../domain/sales';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../domain/services';
import { fromDateInputValue, toDateInputValue } from '../../lib/date';
import { useSales } from '../../state/sales/SalesProvider';

interface ItemForm {
  key: number;
  service: ServiceKey;
  description: string;
  billingType: BillingType;
  amount: string;
  quantity: string;
}

let itemKey = 0;
const newItem = (service: ServiceKey, billingType: BillingType = 'one_time'): ItemForm => ({ key: ++itemKey, service, description: '', billingType, amount: '', quantity: '1' });

export function ProposalEditor({ company, proposal, onSaved, onCancel }: { company: Company; proposal?: Proposal; onSaved: (p: Proposal) => void; onCancel: () => void }) {
  const { createProposal, updateProposal } = useSales();
  const firstService = company.opportunities[0]?.service ?? 'crm';
  const [title, setTitle] = useState(proposal?.title ?? `${company.name} teklifi`);
  const [currency, setCurrency] = useState<Currency>(proposal?.currency ?? 'TRY');
  const [contract, setContract] = useState(proposal?.contractMonths ? String(proposal.contractMonths) : '');
  const [validUntil, setValidUntil] = useState(toDateInputValue(proposal?.validUntil ?? null));
  const [taxMode, setTaxMode] = useState<TaxMode>(proposal?.taxMode ?? 'excluded');
  const [taxRate, setTaxRate] = useState(proposal?.taxRateBp !== null && proposal?.taxRateBp !== undefined ? String(proposal.taxRateBp / 100).replace('.', ',') : '20');
  const [notes, setNotes] = useState(proposal?.notes ?? '');
  const [items, setItems] = useState<ItemForm[]>(() =>
    proposal?.items.length
      ? proposal.items.map((i) => ({ key: ++itemKey, service: i.service, description: i.description, billingType: i.billingType, amount: minorToInput(i.unitAmountMinor), quantity: String(i.quantity) }))
      : [newItem(firstService)],
  );
  const [addOpps, setAddOpps] = useState<ServiceKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = items.map((i) => ({ ...i, minor: parseAmountToMinor(i.amount), qty: Number(i.quantity) }));
  const totals = useMemo(
    () => proposalTotals(parsed.filter((i) => i.minor !== null && Number.isInteger(i.qty) && i.qty >= 1).map((i) => ({ billingType: i.billingType, unitAmountMinor: i.minor!, quantity: i.qty }))),
    [parsed],
  );
  const missingOpps = [...new Set(items.map((i) => i.service))].filter((s) => !company.opportunities.some((o) => o.service === s));
  const update = (key: number, patch: Partial<ItemForm>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const bad = parsed.find((i) => i.minor === null || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 1000);
    if (bad) return setError('Her kalem için geçerli bir tutar (ör. 12.500,00) ve 1 ile 1000 arasında adet gir.');
    const months = contract.trim() ? Number(contract) : null;
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > MAX_CONTRACT_MONTHS)) return setError(`Sözleşme süresi 1 ile ${MAX_CONTRACT_MONTHS} ay arasında olmalı.`);
    const rate = taxMode === 'unspecified' || !taxRate.trim() ? null : Number(taxRate.replace(',', '.'));
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) return setError('Vergi oranı 0 ile 100 arasında olmalı.');
    const input: ProposalInput = {
      title: title.trim(),
      currency,
      contractMonths: months,
      validUntil: fromDateInputValue(validUntil),
      notes: notes.trim(),
      taxMode,
      taxRateBp: rate === null ? null : Math.round(rate * 100),
      items: parsed.map((i) => ({ service: i.service, description: i.description.trim(), billingType: i.billingType, unitAmountMinor: i.minor!, quantity: i.qty })),
    };
    const opps = addOpps.filter((s) => missingOpps.includes(s));
    setBusy(true);
    try {
      onSaved(proposal ? await updateProposal(proposal.id, input, opps) : await createProposal(company.id, input, opps));
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  };

  return (
    <form className="sales-form proposal-editor" onSubmit={(e) => void onSubmit(e)} aria-label={proposal ? 'Teklifi düzenle' : 'Yeni teklif'}>
      <div className="sales-form__grid">
        <label className="field proposal-editor__title">
          <span className="field__label">Teklif başlığı</span>
          <input className="input" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Para birimi</span>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Sözleşme süresi (ay)</span>
          <input className="input" inputMode="numeric" value={contract} onChange={(e) => setContract(e.target.value)} placeholder="ör. 6" />
        </label>
        <label className="field">
          <span className="field__label">Geçerlilik tarihi</span>
          <input type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Vergi</span>
          <select className="input" value={taxMode} onChange={(e) => setTaxMode(e.target.value as TaxMode)}>
            {TAX_MODES.map((m) => (
              <option key={m} value={m}>
                {TAX_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        {taxMode !== 'unspecified' && (
          <label className="field">
            <span className="field__label">Vergi oranı (%)</span>
            <input className="input" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="20" />
          </label>
        )}
      </div>

      <fieldset className="proposal-items">
        <legend className="field__label">Kalemler</legend>
        {items.map((i, index) => (
          <div key={i.key} className="proposal-item" aria-label={`Kalem ${index + 1}`}>
            <select className="input" aria-label="Hizmet" value={i.service} onChange={(e) => update(i.key, { service: e.target.value as ServiceKey })}>
              {SERVICE_KEYS.map((s) => (
                <option key={s} value={s}>
                  {SERVICES[s].label}
                </option>
              ))}
            </select>
            <input className="input proposal-item__desc" aria-label="Açıklama" value={i.description} maxLength={300} placeholder="Açıklama" onChange={(e) => update(i.key, { description: e.target.value })} />
            <select className="input" aria-label="Ödeme tipi" value={i.billingType} onChange={(e) => update(i.key, { billingType: e.target.value as BillingType })}>
              {BILLING_TYPES.map((b) => (
                <option key={b} value={b}>
                  {BILLING_TYPE_LABELS[b]}
                </option>
              ))}
            </select>
            <input className="input proposal-item__amount" aria-label={`Tutar (${currency})`} inputMode="decimal" value={i.amount} placeholder="0,00" onChange={(e) => update(i.key, { amount: e.target.value })} />
            <input className="input proposal-item__qty" aria-label="Adet" inputMode="numeric" value={i.quantity} onChange={(e) => update(i.key, { quantity: e.target.value })} />
            <button type="button" className="button button--ghost button--sm" aria-label="Kalemi sil" onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
        {items.length < MAX_PROPOSAL_ITEMS && (
          <button type="button" className="button button--secondary button--sm" onClick={() => setItems((list) => [...list, newItem(firstService, 'monthly')])}>
            <Plus size={14} aria-hidden="true" /> Kalem Ekle
          </button>
        )}
      </fieldset>

      <dl className="proposal-totals" aria-label="Toplamlar">
        <div>
          <dt>Tek seferlik toplam</dt>
          <dd>{formatMoney(totals.oneTimeMinor, currency)}</dd>
        </div>
        <div>
          <dt>Aylık tekrarlayan toplam</dt>
          <dd>{formatMoney(totals.monthlyMinor, currency)}</dd>
        </div>
        <div>
          <dt>Vergi</dt>
          <dd>{TAX_MODE_LABELS[taxMode]}{taxMode !== 'unspecified' && taxRate.trim() ? ` (%${taxRate})` : ''}</dd>
        </div>
      </dl>
      <p className="sales-hint">Tek seferlik ve aylık tutarlar ayrı gösterilir; toplanarak tek bir rakam yapılmaz. Vergi hesaplanmaz, yalnızca belirtilir.</p>

      {missingOpps.length > 0 && (
        <div className="proposal-opps">
          {missingOpps.map((s) => (
            <label key={s} className="stage-move__check">
              <input type="checkbox" checked={addOpps.includes(s)} onChange={(e) => setAddOpps((list) => (e.target.checked ? [...list, s] : list.filter((x) => x !== s)))} />
              <span>
                <strong>{SERVICES[s].label}</strong>: Bu hizmeti opportunity olarak da ekle
              </span>
            </label>
          ))}
        </div>
      )}

      <label className="field">
        <span className="field__label">Teklif notları</span>
        <textarea className="input textarea" rows={3} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="Kapsam, teslim süresi, koşullar…" />
      </label>

      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={busy || !title.trim()}>
          {proposal ? 'Değişiklikleri Kaydet' : 'Teklifi Oluştur'}
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}
