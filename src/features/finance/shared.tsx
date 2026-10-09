// Building blocks shared by KITE Finans and Berk. Each page passes its own data; nothing here mixes
// the two sides. Amounts are always shown per currency.
import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, Repeat } from 'lucide-react';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import {
  addMonthsToMonth,
  categoryLabel,
  effectiveDay,
  ENTRY_KINDS,
  FINANCE_CURRENCIES,
  FINANCE_STATUS_LABELS,
  FINANCE_STATUSES,
  FINANCE_TABS,
  formatAmount,
  formatDay,
  formatMonth,
  isLatestOfSeries,
  isOverdue,
  KITE_CATEGORIES,
  KITE_KIND_LABELS,
  kindOf,
  monthIndependentTab,
  nextOccurrenceDays,
  PERSONAL_CATEGORIES,
  PERSONAL_KIND_LABELS,
  type CurrencyTotals,
  type EntryKind,
  type FinanceCurrency,
  type FinanceEntry,
  type FinanceFilters,
  type FinanceStatus,
  type FinanceTab,
} from '../../domain/finance';

export type Scope = 'kite' | 'personal';
export const kindLabels = (scope: Scope) => (scope === 'kite' ? KITE_KIND_LABELS : PERSONAL_KIND_LABELS);
export const categories = (scope: Scope): Record<string, string> => (scope === 'kite' ? KITE_CATEGORIES : PERSONAL_CATEGORIES);

export const STATUS_TONE: Record<FinanceStatus, BadgeTone> = { pending: 'warning', paid: 'success', cancelled: 'neutral' };

/** "TRY 42.000 · USD 850" — or a dash when there is nothing. */
export function Money({ totals, empty = '—', signed = false }: { totals: CurrencyTotals; empty?: string; signed?: boolean }) {
  if (totals.length === 0) return <span className="fin-money fin-money--empty">{empty}</span>;
  return (
    <span className="fin-money">
      {totals.map((t) => (
        <span key={t.currency} className={signed && t.amountMinor < 0 ? 'fin-money__item fin-money__item--neg' : 'fin-money__item'}>
          {signed && t.amountMinor > 0 ? '+' : ''}
          {formatAmount(t.amountMinor, t.currency)}
        </span>
      ))}
    </span>
  );
}

export function SummaryTile({ label, totals, hint, tone }: { label: string; totals: CurrencyTotals; hint?: ReactNode; tone?: 'in' | 'out' | 'pending' }) {
  return (
    <div className={`fin-tile${tone ? ` fin-tile--${tone}` : ''}`}>
      <p className="fin-tile__label">{label}</p>
      <div className="fin-tile__value">
        <Money totals={totals} />
      </div>
      {hint && <p className="fin-tile__hint">{hint}</p>}
    </div>
  );
}

export function MonthSwitcher({ month, onChange, current }: { month: string; onChange: (m: string) => void; current: string }) {
  return (
    <div className="fin-month" role="group" aria-label="Ay seçimi">
      <button type="button" className="icon-button" aria-label="Önceki ay" onClick={() => onChange(addMonthsToMonth(month, -1))}>
        <ChevronLeft size={16} />
      </button>
      <span className="fin-month__label" aria-live="polite">
        {formatMonth(month)}
      </span>
      <button type="button" className="icon-button" aria-label="Sonraki ay" onClick={() => onChange(addMonthsToMonth(month, 1))}>
        <ChevronRight size={16} />
      </button>
      {month !== current && (
        <button type="button" className="button button--ghost button--sm" onClick={() => onChange(current)}>
          Bu ay
        </button>
      )}
    </div>
  );
}

export function FilterBar({
  scope,
  filters,
  onChange,
  tabLabels,
  counts,
  onExport,
  exportDisabled,
}: {
  scope: Scope;
  filters: FinanceFilters;
  onChange: (f: FinanceFilters) => void;
  tabLabels: Record<FinanceTab, string>;
  counts: Record<FinanceTab, number>;
  onExport: () => void;
  exportDisabled: boolean;
}) {
  const set = (patch: Partial<FinanceFilters>) => onChange({ ...filters, ...patch });
  const labels = kindLabels(scope);
  return (
    <>
      <div className="proposal-filters" role="tablist" aria-label="Görünüm">
        {FINANCE_TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={filters.tab === t} className={filters.tab === t ? 'proposal-filter proposal-filter--active' : 'proposal-filter'} onClick={() => set({ tab: t })}>
            {tabLabels[t]} <span className="pipeline-group__count">{counts[t]}</span>
          </button>
        ))}
      </div>
      <div className="work-filters fin-filters">
        <select className="input input--sm" aria-label="Para birimi" value={filters.currency ?? ''} onChange={(e) => set({ currency: (e.target.value || null) as FinanceCurrency | null })}>
          <option value="">Tüm para birimleri</option>
          {FINANCE_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="input input--sm" aria-label="Kategori" value={filters.category ?? ''} onChange={(e) => set({ category: e.target.value || null })}>
          <option value="">Tüm kategoriler</option>
          {Object.entries(categories(scope)).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="input input--sm" aria-label="Tür" value={filters.kind ?? ''} onChange={(e) => set({ kind: (e.target.value || null) as EntryKind | null })}>
          <option value="">Tüm türler</option>
          {ENTRY_KINDS.map((k) => (
            <option key={k} value={k}>
              {labels[k]}
            </option>
          ))}
        </select>
        <select className="input input--sm" aria-label="Durum" value={filters.status ?? ''} onChange={(e) => set({ status: (e.target.value || null) as FinanceStatus | null })}>
          <option value="">Tüm durumlar</option>
          {FINANCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FINANCE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button type="button" className="button button--ghost button--sm fin-filters__export" onClick={onExport} disabled={exportDisabled}>
          <Download size={14} aria-hidden="true" /> CSV
        </button>
      </div>
      <p className="fin-filters__note">{monthIndependentTab(filters.tab) ? 'Bekleyen ve Yaklaşan tüm ayların açık kayıtlarını gösterir; en yakın vade önce.' : `${filters.month ? formatMonth(filters.month) : 'Tüm aylar'} · en yeni önce. Ödenenler ödeme tarihine, bekleyenler vadesine göre aya yazılır.`}</p>
    </>
  );
}

/** Table on wide screens, stacked cards on phones (CSS). */
export function EntryList<T extends FinanceEntry>({
  scope,
  rows,
  all,
  today,
  linkOf,
  onOpen,
  onMarkPaid,
  onNext,
}: {
  scope: Scope;
  rows: T[];
  all: readonly T[];
  today: string;
  linkOf?: (e: T) => ReactNode;
  onOpen: (e: T) => void;
  onMarkPaid: (e: T) => void;
  onNext: (e: T) => void;
}) {
  const labels = kindLabels(scope);
  return (
    <div className="table-wrap fin-table-wrap">
      <table className="table fin-table">
        <thead>
          <tr>
            <th scope="col">Tarih</th>
            <th scope="col">Başlık</th>
            <th scope="col">{scope === 'kite' ? 'Şirket / Müşteri' : 'Kişi / Yer'}</th>
            <th scope="col">Kategori</th>
            <th scope="col">Tür</th>
            <th scope="col" className="fin-table__num">
              Tutar
            </th>
            <th scope="col">Durum</th>
            <th scope="col">Vade</th>
            <th scope="col">
              <span className="visually-hidden">İşlemler</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const overdue = isOverdue(e, today);
            const next = isLatestOfSeries(e, all) ? nextOccurrenceDays(e) : null;
            return (
              <tr key={e.id} className={e.status === 'cancelled' ? 'fin-row fin-row--cancelled' : 'fin-row'}>
                <td data-label="Tarih">{formatDay(e.status === 'paid' ? effectiveDay(e) : e.date, today)}</td>
                <td data-label="Başlık" className="fin-table__title">
                  <button type="button" className="link-cell" onClick={() => onOpen(e)}>
                    {e.title}
                  </button>
                  {e.recurrence !== 'none' && (
                    <span className="fin-recur" title={e.recurrence === 'monthly' ? 'Aylık tekrar' : 'Yıllık tekrar'}>
                      <Repeat size={12} aria-hidden="true" /> {e.recurrence === 'monthly' ? 'Aylık' : 'Yıllık'}
                      {next && ` · Sonraki: ${formatDay(next.dueDate ?? next.date, today)}`}
                    </span>
                  )}
                </td>
                <td data-label={scope === 'kite' ? 'Şirket / Müşteri' : 'Kişi / Yer'}>{linkOf?.(e) ?? (e.counterparty || <span className="text-subtle">—</span>)}</td>
                <td data-label="Kategori">{categoryLabel(scope, e.category)}</td>
                <td data-label="Tür">{labels[kindOf(e)]}</td>
                <td data-label="Tutar" className={`fin-table__num fin-amount fin-amount--${e.direction}`}>
                  {e.direction === 'expense' ? '−' : '+'}
                  {formatAmount(e.amountMinor, e.currency)}
                </td>
                <td data-label="Durum">
                  <Badge tone={overdue ? 'danger' : STATUS_TONE[e.status]}>{overdue ? 'Gecikti' : FINANCE_STATUS_LABELS[e.status]}</Badge>
                </td>
                <td data-label="Vade">{e.dueDate ? formatDay(e.dueDate, today) : <span className="text-subtle">—</span>}</td>
                <td className="fin-table__actions">
                  {e.status === 'pending' && (
                    <button type="button" className="button button--secondary button--sm" onClick={() => onMarkPaid(e)}>
                      {e.direction === 'income' ? 'Tahsil edildi' : 'Ödendi'}
                    </button>
                  )}
                  {next && (
                    <button type="button" className="button button--ghost button--sm" onClick={() => onNext(e)} title="Bir sonraki dönemi bekleyen kayıt olarak ekler">
                      Sonrakini ekle
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Small inline "paid on" confirmation: the money's real date, default today. */
export function MarkPaidForm({ entry, today, onConfirm, onCancel, busy }: { entry: FinanceEntry; today: string; onConfirm: (paidOn: string) => void; onCancel: () => void; busy: boolean }) {
  const [paidOn, setPaidOn] = useState(today);
  return (
    <form
      className="sales-form fin-paid"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (paidOn) onConfirm(paidOn);
      }}
    >
      <p className="inline-form__title">
        {entry.title} · {formatAmount(entry.amountMinor, entry.currency)}
      </p>
      <label className="field">
        <span className="field__label">{entry.direction === 'income' ? 'Tahsil edildiği gün' : 'Ödendiği gün'}</span>
        <input type="date" className="input" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} required />
      </label>
      {entry.dueDate && <p className="sales-hint">Vade ({formatDay(entry.dueDate, today)}) kayıtta kalır.</p>}
      <div className="form-actions">
        <button type="submit" className="button button--primary button--sm" disabled={busy || !paidOn}>
          Kaydet
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={onCancel} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}

export function downloadCsv(filename: string, csv: string) {
  // BOM so Excel reads Turkish characters correctly.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const tabCounts = <T extends FinanceEntry>(entries: readonly T[], f: FinanceFilters, today: string, filter: (rows: readonly T[], f: FinanceFilters, today: string) => T[]): Record<FinanceTab, number> =>
  Object.fromEntries(FINANCE_TABS.map((t) => [t, filter(entries, { ...f, tab: t }, today).length])) as Record<FinanceTab, number>;
