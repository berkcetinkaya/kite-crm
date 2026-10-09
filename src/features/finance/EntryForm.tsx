// Add / edit one finance entry (KITE Finans or Berk). "Tür" decides direction and whether the money has
// already moved; a pending entry is later marked paid on the same row. KITE entries may link a CRM
// company or customer; personal entries never do.
import { useState } from 'react';
import { errorMessage } from '../../api/dataApi';
import { containsFinanceSecret, ENTRY_KINDS, FINANCE_COUNTERPARTY_MAX, FINANCE_CURRENCIES, FINANCE_ERROR_MESSAGES, FINANCE_MAX_AMOUNT_MINOR, FINANCE_NOTES_MAX, FINANCE_STATUS_LABELS, FINANCE_TITLE_MAX, kindOf, kindParts, RECURRENCE_LABELS, RECURRENCES, type EntryKind, type FinanceCurrency, type FinanceEntry, type FinanceEntryInput, type FinanceStatus, type Recurrence } from '../../domain/finance';
import { minorToInput, parseAmountToMinor } from '../../domain/sales';
import { compareTr } from '../../lib/text';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { useCustomers } from '../../state/customers/CustomersProvider';
import { categories, kindLabels, type Scope } from './shared';

const DEFAULT_CATEGORY: Record<Scope, Record<'income' | 'expense', string>> = {
  kite: { income: 'client_payment', expense: 'other' },
  personal: { income: 'earnings', expense: 'other' },
};

export interface LinkValue {
  companyId: string | null;
  customerId: string | null;
}

interface Props {
  scope: Scope;
  entry: (FinanceEntry & Partial<LinkValue>) | null;
  today: string;
  defaultKind?: EntryKind;
  onSave: (input: FinanceEntryInput & LinkValue) => Promise<void>;
  onStatus: (to: FinanceStatus) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}

export function EntryForm({ scope, entry, today, defaultKind = 'income', onSave, onStatus, onDelete, onCancel }: Props) {
  const startKind = entry ? kindOf(entry) : defaultKind;
  const [kind, setKind] = useState<EntryKind>(startKind);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [amount, setAmount] = useState(entry ? minorToInput(entry.amountMinor) : '');
  const [currency, setCurrency] = useState<FinanceCurrency>(entry?.currency ?? 'TRY');
  const [category, setCategory] = useState(entry?.category ?? DEFAULT_CATEGORY[scope][kindParts(startKind).direction]);
  const [categoryTouched, setCategoryTouched] = useState(!!entry);
  const [date, setDate] = useState(entry?.date ?? today);
  const [dueDate, setDueDate] = useState(entry?.dueDate ?? '');
  const [paidOn, setPaidOn] = useState(entry?.paidOn ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence>(entry?.recurrence ?? 'none');
  const [counterparty, setCounterparty] = useState(entry?.counterparty ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [companyId, setCompanyId] = useState(entry?.companyId ?? '');
  const [customerId, setCustomerId] = useState(entry?.customerId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = kindLabels(scope);
  const cancelled = entry?.status === 'cancelled';
  const paidKind = kindParts(kind).status === 'paid';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const save = () => {
    const amountMinor = parseAmountToMinor(amount, FINANCE_MAX_AMOUNT_MINOR);
    if (!title.trim()) return setError('Başlık yaz.');
    if (!amountMinor) return setError('Tutarı sıfırdan büyük bir sayı olarak yaz (ör. 12.500 veya 850,50).');
    if (!date) return setError('Tarihi seç.');
    if ([title, notes, counterparty].some(containsFinanceSecret)) return setError(FINANCE_ERROR_MESSAGES.finance_secret);
    void run(() =>
      onSave({
        kind,
        title: title.trim(),
        notes: notes.trim(),
        counterparty: counterparty.trim(),
        amountMinor,
        currency,
        category,
        date,
        dueDate: dueDate || null,
        paidOn: paidKind ? paidOn || null : null,
        recurrence,
        companyId: scope === 'kite' ? companyId || null : null,
        customerId: scope === 'kite' ? customerId || null : null,
      }),
    );
  };

  return (
    <div className="sales-form fin-form" aria-label={entry ? 'Kaydı düzenle' : 'Yeni kayıt'}>
      {cancelled && <p className="sales-hint sales-hint--warn">Bu kayıt iptal edildi. Düzenlemek için önce yeniden aç.</p>}
      <fieldset className="fin-form__kinds" disabled={cancelled}>
        <legend className="field__label">Tür</legend>
        <div className="chip-row">
          {ENTRY_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              className={kind === k ? 'filter-chip filter-chip--on' : 'filter-chip'}
              onClick={() => {
                setKind(k);
                if (!categoryTouched) setCategory(DEFAULT_CATEGORY[scope][kindParts(k).direction]);
              }}
            >
              {labels[k]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="fin-form__fields" disabled={cancelled}>
        <label className="field">
          <span className="field__label">Başlık</span>
          <input className="input" maxLength={FINANCE_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={scope === 'kite' ? 'ör. Aylık yönetim ücreti' : 'ör. Kira'} autoFocus />
        </label>
        <div className="sales-form__grid">
          <label className="field">
            <span className="field__label">Tutar</span>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12.500" />
          </label>
          <label className="field">
            <span className="field__label">Para birimi</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as FinanceCurrency)}>
              {FINANCE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Kategori</span>
            <select
              className="input"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setCategoryTouched(true);
              }}
            >
              {Object.entries(categories(scope)).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Tarih</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Vade (isteğe bağlı)</span>
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          {paidKind && (
            <label className="field">
              <span className="field__label">{kindParts(kind).direction === 'income' ? 'Tahsil edildiği gün' : 'Ödendiği gün'}</span>
              <input type="date" className="input" value={paidOn} placeholder={date} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span className="field__label">Tekrar</span>
            <select className="input" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{scope === 'kite' ? 'Kimden / Kime (isteğe bağlı)' : 'Kişi / Yer (isteğe bağlı)'}</span>
            <input className="input" maxLength={FINANCE_COUNTERPARTY_MAX} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder={scope === 'kite' ? 'ör. DeseTour' : 'ör. Ev sahibi'} />
          </label>
          {scope === 'kite' && <CrmLinkFields companyId={companyId} customerId={customerId} onChange={(v) => (setCompanyId(v.companyId ?? ''), setCustomerId(v.customerId ?? ''))} />}
        </div>
        <label className="field">
          <span className="field__label">Not</span>
          <textarea className="input textarea" rows={2} maxLength={FINANCE_NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </fieldset>
      <p className="sales-hint">
        {recurrence !== 'none' ? 'Tekrarlanan kayıt kendiliğinden çoğalmaz; listede “Sonrakini ekle” ile bir sonraki dönemi eklersin. ' : ''}
        Kart numarası, şifre, PIN veya erişim bilgisi yazma.
      </p>
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions fin-form__actions">
        {!cancelled && (
          <button type="button" className="button button--primary button--sm" onClick={save} disabled={busy}>
            {entry ? 'Kaydet' : 'Ekle'}
          </button>
        )}
        {entry?.status === 'pending' && (
          <button type="button" className="button button--ghost button--sm" onClick={() => window.confirm('Kayıt iptal edilsin mi? Özetlere sayılmaz.') && void run(() => onStatus('cancelled'))} disabled={busy}>
            İptal et
          </button>
        )}
        {entry && entry.status !== 'pending' && (
          <button type="button" className="button button--secondary button--sm" onClick={() => void run(() => onStatus('pending'))} disabled={busy}>
            {entry.status === 'paid' ? `${FINANCE_STATUS_LABELS.pending} durumuna al` : 'Yeniden aç'}
          </button>
        )}
        {entry && (
          <button type="button" className="button button--ghost button--sm fin-form__delete" onClick={() => window.confirm(`“${entry.title}” kalıcı olarak silinsin mi? Bu geri alınamaz.`) && void run(onDelete)} disabled={busy}>
            Sil
          </button>
        )}
        <button type="button" className="button button--ghost button--sm" onClick={onCancel} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

/** Optional CRM link for KITE entries; a customer fills in its company. */
function CrmLinkFields({ companyId, customerId, onChange }: { companyId: string; customerId: string; onChange: (v: LinkValue) => void }) {
  const { companies } = useCompanies();
  const { customers } = useCustomers();
  const companyCustomers = customers.filter((c) => !companyId || c.companyId === companyId);
  return (
    <>
      <label className="field">
        <span className="field__label">Şirket (isteğe bağlı)</span>
        <select
          className="input"
          value={companyId}
          onChange={(e) => onChange({ companyId: e.target.value || null, customerId: customers.some((c) => c.id === customerId && c.companyId === e.target.value) ? customerId : null })}
        >
          <option value="">Bağlantı yok</option>
          {[...companies].sort((a, b) => compareTr(a.name, b.name)).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Müşteri kaydı (isteğe bağlı)</span>
        <select
          className="input"
          value={customerId}
          disabled={companyCustomers.length === 0}
          onChange={(e) => {
            const c = customers.find((x) => x.id === e.target.value);
            onChange({ companyId: c ? c.companyId : companyId || null, customerId: c ? c.id : null });
          }}
        >
          <option value="">{companyCustomers.length === 0 ? 'Müşteri kaydı yok' : 'Yok'}</option>
          {companyCustomers.map((c) => (
            <option key={c.id} value={c.id}>
              {companies.find((x) => x.id === c.companyId)?.name ?? 'Müşteri'}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
