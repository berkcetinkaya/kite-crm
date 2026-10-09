// Berk › Borçlar: one record per debt and its repayments. The remaining balance is always derived
// (total − repayments); a repayment above the remaining balance is refused by the server.
import { useState } from 'react';
import { HandCoins, Plus, Trash2 } from 'lucide-react';
import { errorMessage } from '../../api/dataApi';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  addMonthsToDay,
  containsFinanceSecret,
  debtPaid,
  debtRemaining,
  FINANCE_CURRENCIES,
  FINANCE_ERROR_MESSAGES,
  FINANCE_MAX_AMOUNT_MINOR,
  formatAmount,
  formatDay,
  isDebtOpen,
  type DebtPaymentInput,
  type FinanceCurrency,
  type PersonalDebt,
  type PersonalDebtInput,
} from '../../domain/finance';
import { minorToInput, parseAmountToMinor } from '../../domain/sales';

const amountOf = (text: string) => parseAmountToMinor(text, FINANCE_MAX_AMOUNT_MINOR);

export function DebtsSection({
  debts,
  today,
  onAdd,
  onEdit,
  onPay,
  onRemovePayment,
}: {
  debts: PersonalDebt[];
  today: string;
  onAdd: () => void;
  onEdit: (d: PersonalDebt) => void;
  onPay: (d: PersonalDebt, input: DebtPaymentInput) => Promise<void>;
  onRemovePayment: (d: PersonalDebt, paymentId: string) => Promise<void>;
}) {
  const [paying, setPaying] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const open = debts.filter(isDebtOpen);
  const closed = debts.filter((d) => !isDebtOpen(d));
  const shown = showClosed ? [...open, ...closed] : open;

  return (
    <section className="card" aria-labelledby="fin-debts-title">
      <div className="card__header">
        <h2 className="card__title" id="fin-debts-title">
          Borçlar
        </h2>
        <button type="button" className="button button--secondary button--sm" onClick={onAdd}>
          <Plus size={14} aria-hidden="true" /> Yeni borç
        </button>
      </div>
      <div className="card__body">
        {debts.length === 0 ? (
          <EmptyState icon={HandCoins} title="Kayıtlı borç yok" description="Bir borç eklediğinde ödemelerini girersin; kalan tutar otomatik hesaplanır." />
        ) : (
          <ul className="fin-debts">
            {shown.map((d) => {
              const paid = debtPaid(d);
              const remaining = debtRemaining(d);
              const pct = Math.min(100, Math.round((paid / d.principalMinor) * 100));
              return (
                <li key={d.id} className="fin-debt">
                  <div className="fin-debt__head">
                    <button type="button" className="link-cell fin-debt__name" onClick={() => onEdit(d)}>
                      {d.creditor}
                    </button>
                    {remaining === 0 ? <Badge tone="success">Kapandı</Badge> : d.nextDueDate && d.nextDueDate < today ? <Badge tone="danger">Ödeme gecikti</Badge> : null}
                  </div>
                  <dl className="fin-debt__grid">
                    <div>
                      <dt>Toplam borç</dt>
                      <dd>{formatAmount(d.principalMinor, d.currency)}</dd>
                    </div>
                    <div>
                      <dt>Ödenen</dt>
                      <dd>{formatAmount(paid, d.currency)}</dd>
                    </div>
                    <div>
                      <dt>Kalan</dt>
                      <dd className="fin-debt__remaining">{formatAmount(remaining, d.currency)}</dd>
                    </div>
                    <div>
                      <dt>Sonraki ödeme</dt>
                      <dd>
                        {d.nextDueDate ? formatDay(d.nextDueDate, today) : '—'}
                        {d.installmentMinor && remaining > 0 ? <span className="text-subtle"> · {formatAmount(Math.min(d.installmentMinor, remaining), d.currency)}</span> : null}
                      </dd>
                    </div>
                  </dl>
                  <div className="fin-progress" role="progressbar" aria-label={`${d.creditor} ödenen oran`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  {remaining > 0 && paying !== d.id && (
                    <button type="button" className="button button--secondary button--sm" onClick={() => setPaying(d.id)}>
                      Ödeme ekle
                    </button>
                  )}
                  {paying === d.id && (
                    <PaymentForm
                      debt={d}
                      today={today}
                      onCancel={() => setPaying(null)}
                      onSave={async (input) => {
                        await onPay(d, input);
                        setPaying(null);
                      }}
                    />
                  )}
                  {d.payments.length > 0 && (
                    <details className="fin-debt__payments">
                      <summary>Ödemeler ({d.payments.length})</summary>
                      <ul>
                        {[...d.payments].reverse().map((p) => (
                          <li key={p.id}>
                            <span>{formatDay(p.paidOn, today)}</span>
                            <span>{formatAmount(p.amountMinor, d.currency)}</span>
                            {p.notes && <span className="text-subtle">{p.notes}</span>}
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`${formatDay(p.paidOn, today)} ödemesini sil`}
                              onClick={() => window.confirm('Bu ödeme silinsin mi? Kalan borç yeniden artar.') && void onRemovePayment(d, p.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {closed.length > 0 && (
          <button type="button" className="dash-more" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Kapanan borçları gizle' : `Kapanan borçlar (${closed.length})`}
          </button>
        )}
      </div>
    </section>
  );
}

function PaymentForm({ debt, today, onSave, onCancel }: { debt: PersonalDebt; today: string; onSave: (p: DebtPaymentInput) => Promise<void>; onCancel: () => void }) {
  const remaining = debtRemaining(debt);
  const [amount, setAmount] = useState(minorToInput(Math.min(debt.installmentMinor ?? remaining, remaining)));
  const [paidOn, setPaidOn] = useState(today);
  const [nextDue, setNextDue] = useState(debt.nextDueDate ? addMonthsToDay(debt.nextDueDate, 1) : '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const amountMinor = amountOf(amount);
    if (!amountMinor) return setError('Tutarı sıfırdan büyük bir sayı olarak yaz.');
    if (amountMinor > remaining) return setError(`${FINANCE_ERROR_MESSAGES.debt_overpayment} Kalan: ${formatAmount(remaining, debt.currency)}.`);
    if (containsFinanceSecret(notes)) return setError(FINANCE_ERROR_MESSAGES.finance_secret);
    setBusy(true);
    setError(null);
    try {
      await onSave({ amountMinor, paidOn, notes: notes.trim(), nextDueDate: amountMinor === remaining ? null : nextDue || null });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="sales-form sales-form--inline"
      aria-label={`${debt.creditor} ödeme ekle`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="sales-form__grid">
        <label className="field">
          <span className="field__label">Tutar ({debt.currency})</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Ödeme günü</span>
          <input type="date" className="input" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">Sonraki ödeme (isteğe bağlı)</span>
          <input type="date" className="input" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Not</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ör. Havale" />
        </label>
      </div>
      <p className="sales-hint">Kalan: {formatAmount(remaining, debt.currency)}. Kalandan fazla ödeme kaydedilmez.</p>
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button button--primary button--sm" disabled={busy}>
          Ödemeyi kaydet
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={onCancel} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}

export function DebtForm({ debt, today, onSave, onDelete, onCancel }: { debt: PersonalDebt | null; today: string; onSave: (input: PersonalDebtInput) => Promise<void>; onDelete: () => Promise<void>; onCancel: () => void }) {
  const [creditor, setCreditor] = useState(debt?.creditor ?? '');
  const [principal, setPrincipal] = useState(debt ? minorToInput(debt.principalMinor) : '');
  const [currency, setCurrency] = useState<FinanceCurrency>(debt?.currency ?? 'TRY');
  const [startDate, setStartDate] = useState(debt?.startDate ?? today);
  const [nextDueDate, setNextDueDate] = useState(debt?.nextDueDate ?? '');
  const [installment, setInstallment] = useState(debt?.installmentMinor ? minorToInput(debt.installmentMinor) : '');
  const [notes, setNotes] = useState(debt?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPayments = !!debt?.payments.length;

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
    const principalMinor = amountOf(principal);
    const installmentMinor = installment.trim() ? amountOf(installment) : null;
    if (!creditor.trim()) return setError('Kime borçlu olduğunu yaz.');
    if (!principalMinor) return setError('Toplam borcu sıfırdan büyük bir sayı olarak yaz.');
    if (installment.trim() && !installmentMinor) return setError('Taksit tutarı geçersiz.');
    if (debt && principalMinor < debtPaid(debt)) return setError(`Toplam borç, ödenen ${formatAmount(debtPaid(debt), debt.currency)} tutarından az olamaz.`);
    if ([creditor, notes].some(containsFinanceSecret)) return setError(FINANCE_ERROR_MESSAGES.finance_secret);
    void run(() => onSave({ creditor: creditor.trim(), notes: notes.trim(), currency, principalMinor, startDate, nextDueDate: nextDueDate || null, installmentMinor }));
  };

  return (
    <div className="sales-form fin-form" aria-label={debt ? 'Borcu düzenle' : 'Yeni borç'}>
      <label className="field">
        <span className="field__label">Kime / nereye borç</span>
        <input className="input" maxLength={120} value={creditor} onChange={(e) => setCreditor(e.target.value)} placeholder="ör. Yasemin" autoFocus />
      </label>
      <div className="sales-form__grid">
        <label className="field">
          <span className="field__label">Toplam borç</span>
          <input className="input" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="120.000" />
        </label>
        <label className="field">
          <span className="field__label">Para birimi</span>
          <select className="input" value={currency} disabled={hasPayments} onChange={(e) => setCurrency(e.target.value as FinanceCurrency)}>
            {FINANCE_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Başlangıç</span>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Sonraki ödeme (isteğe bağlı)</span>
          <input type="date" className="input" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Taksit tutarı (isteğe bağlı)</span>
          <input className="input" inputMode="decimal" value={installment} onChange={(e) => setInstallment(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="field__label">Not</span>
        <textarea className="input textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {debt && (
        <p className="sales-hint">
          Ödenen: {formatAmount(debtPaid(debt), debt.currency)} · Kalan: {formatAmount(debtRemaining(debt), debt.currency)}
          {hasPayments ? ' · Ödeme yapılmış borcun para birimi değişmez.' : ''}
        </p>
      )}
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button button--primary button--sm" onClick={save} disabled={busy}>
          {debt ? 'Kaydet' : 'Borç ekle'}
        </button>
        {debt && (
          <button type="button" className="button button--ghost button--sm fin-form__delete" onClick={() => window.confirm(`“${debt.creditor}” borcu ve tüm ödemeleri kalıcı olarak silinsin mi?`) && void run(onDelete)} disabled={busy}>
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
