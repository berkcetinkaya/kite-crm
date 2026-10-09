// Berk (schema v9): personal income, spending, debts, recurring payments and a monthly budget per
// currency. Completely separate from KITE Finans (own tables and endpoints). No FX, no bank sync.
import { useCallback, useState } from 'react';
import { CalendarClock, PiggyBank, Plus, RefreshCw, Repeat } from 'lucide-react';
import { errorMessage } from '../../api/dataApi';
import { personalFinanceApi } from '../../api/financeApi';
import { Badge } from '../../components/ui/Badge';
import { Drawer } from '../../components/ui/Drawer';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import {
  entriesToCsv,
  filterEntries,
  FINANCE_CURRENCIES,
  FINANCE_MAX_AMOUNT_MINOR,
  formatAmount,
  formatDay,
  formatMonth,
  latestOfSeries,
  monthOf,
  nextOccurrenceDays,
  PERSONAL_TAB_LABELS,
  personalMonthView,
  todayKey,
  upcomingPersonalPayments,
  type FinanceCurrency,
  type FinanceFilters,
  type PersonalDebt,
  type PersonalFinanceData,
  type PersonalFinanceEntry,
} from '../../domain/finance';
import { minorToInput, parseAmountToMinor } from '../../domain/sales';
import { DebtForm, DebtsSection } from './DebtsSection';
import { EntryForm } from './EntryForm';
import { downloadCsv, EntryList, FilterBar, MarkPaidForm, Money, MonthSwitcher, SummaryTile, tabCounts } from './shared';
import { useFinanceData } from './useFinanceData';
import '../sales/sales.css';
import '../tasks/tasks.css';
import './finance.css';

export function PersonalFinancePage() {
  const { data, loading, error, reload, mutate } = useFinanceData(useCallback((s: AbortSignal) => personalFinanceApi.load(s), []));
  const showToast = useToast();
  const today = todayKey();
  const [month, setMonth] = useState(monthOf(today));
  const [filters, setFilters] = useState<FinanceFilters>({ tab: 'all', month: null, currency: null, category: null, status: null, kind: null });
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [debtForm, setDebtForm] = useState<{ id: string | null } | null>(null);
  const [paying, setPaying] = useState<PersonalFinanceEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const entries = data?.entries ?? [];
  const active = { ...filters, month };
  const rows = filterEntries(entries, active, today);
  const counts = tabCounts(entries, active, today, filterEntries);
  const view = data ? personalMonthView(data, month) : null;
  const upcoming = data ? upcomingPersonalPayments(data, today) : [];
  const recurringItems = latestOfSeries(entries).filter((e) => e.direction === 'expense');
  const editing = form?.id ? entries.find((e) => e.id === form.id) ?? null : null;
  const editingDebt = debtForm?.id ? data?.debts.find((d) => d.id === debtForm.id) ?? null : null;

  const act = async (fn: () => Promise<PersonalFinanceData>, toast: string) => {
    setBusy(true);
    try {
      await mutate(fn);
      showToast({ title: toast });
      return true;
    } catch (e) {
      showToast({ tone: 'error', title: 'Kaydedilemedi', description: errorMessage(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page fin-page">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Berk</h1>
          <p className="page-header__subtitle">Kişisel gelir, harcama, borç ve bütçe. KITE Finans'tan tamamen ayrı tutulur; para birimleri birbirine çevrilmez.</p>
        </div>
        <div className="tasks-page__tools">
          <button type="button" className="button button--ghost button--sm" onClick={() => void reload()} disabled={loading} aria-label="Yenile">
            <RefreshCw size={14} aria-hidden="true" className={loading ? 'spin' : undefined} /> Yenile
          </button>
          <button type="button" className="button button--secondary" onClick={() => setDebtForm({ id: null })} disabled={!data}>
            <Plus size={16} aria-hidden="true" /> Yeni Borç
          </button>
          <button type="button" className="button button--primary" onClick={() => setForm({ id: null })} disabled={!data}>
            <Plus size={16} aria-hidden="true" /> Yeni Kayıt
          </button>
        </div>
      </header>

      {error && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          Kişisel finans yüklenemedi: {error}
        </p>
      )}

      {!data || !view ? (
        !error && <p className="dash-empty" aria-busy="true">Kişisel finans yükleniyor…</p>
      ) : (
        <>
          <section className="card fin-summary" aria-label="Aylık özet">
            <div className="fin-summary__head">
              <MonthSwitcher month={month} onChange={setMonth} current={monthOf(today)} />
            </div>
            <div className="fin-tiles">
              <SummaryTile label="Gelir" totals={view.income} tone="in" hint="Bu ay gelen" />
              <SummaryTile label="Harcama" totals={view.expense} tone="out" hint="Bu ay ödenen (borç ödemeleri hariç)" />
              <SummaryTile label="Borç ödemeleri" totals={view.debtRepayments} tone="out" hint="Bu ay yapılan" />
              <SummaryTile label="Kalan borç" totals={view.debtRemaining} tone="pending" hint="Tüm açık borçlar" />
            </div>
          </section>

          <BudgetCard data={data} month={month} view={view} busy={busy} onSet={(c, v) => act(() => personalFinanceApi.setBudget(c, v), v === null ? 'Bütçe kaldırıldı' : 'Bütçe kaydedildi')} />

          <div className="fin-pair">
            <section className="card" aria-labelledby="fin-upcoming-title">
              <div className="card__header">
                <h2 className="card__title" id="fin-upcoming-title">
                  Yaklaşan ödemeler
                </h2>
                <span className="card__subtitle">30 gün · gecikenler dahil</span>
              </div>
              <div className="card__body card__body--flush">
                {upcoming.length === 0 ? (
                  <p className="dash-empty">
                    <CalendarClock size={14} aria-hidden="true" /> Önümüzdeki 30 günde bekleyen ödeme yok.
                  </p>
                ) : (
                  <ul className="fin-mini-list">
                    {upcoming.map((u) => (
                      <li key={`${u.source}-${u.key}`}>
                        <span className="fin-mini-list__main">
                          {u.title}
                          {u.overdue && <Badge tone="danger">Gecikti</Badge>}
                        </span>
                        <span className="fin-mini-list__meta">
                          {formatDay(u.day, today)} · <strong>{formatAmount(u.amountMinor, u.currency)}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            <section className="card" aria-labelledby="fin-recurring-title">
              <div className="card__header">
                <h2 className="card__title" id="fin-recurring-title">
                  Tekrarlanan ödemeler
                </h2>
                <span className="card__subtitle">
                  {view.recurring.monthly.length > 0 && (
                    <>
                      <Money totals={view.recurring.monthly} /> / ay
                    </>
                  )}
                  {view.recurring.yearly.length > 0 && (
                    <>
                      {' '}
                      · <Money totals={view.recurring.yearly} /> / yıl
                    </>
                  )}
                </span>
              </div>
              <div className="card__body card__body--flush">
                {recurringItems.length === 0 ? (
                  <p className="dash-empty">
                    <Repeat size={14} aria-hidden="true" /> Tekrarlanan ödeme yok. Kira, motor veya abonelik eklerken “Tekrar: Aylık” seç.
                  </p>
                ) : (
                  <ul className="fin-mini-list">
                    {recurringItems.map((e) => {
                      const next = nextOccurrenceDays(e);
                      return (
                        <li key={e.seriesId}>
                          <span className="fin-mini-list__main">
                            <button type="button" className="link-cell" onClick={() => setForm({ id: e.id })}>
                              {e.title}
                            </button>
                            <span className="text-subtle">{e.recurrence === 'monthly' ? 'Aylık' : 'Yıllık'}</span>
                          </span>
                          <span className="fin-mini-list__meta">
                            <strong>{formatAmount(e.amountMinor, e.currency)}</strong>
                            {next && ` · Sonraki: ${formatDay(next.dueDate ?? next.date, today)}`}
                            {next && (
                              <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void act(() => personalFinanceApi.next(e.id), 'Sonraki dönem eklendi')}>
                                Sonrakini ekle
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <DebtsSection
            debts={data.debts}
            today={today}
            onAdd={() => setDebtForm({ id: null })}
            onEdit={(d) => setDebtForm({ id: d.id })}
            onPay={async (d, input) => {
              await mutate(() => personalFinanceApi.addPayment(d.id, input));
              showToast({ title: 'Ödeme kaydedildi', description: `${d.creditor} · ${formatAmount(input.amountMinor, d.currency)}` });
            }}
            onRemovePayment={async (d, pid) => void (await act(() => personalFinanceApi.removePayment(d.id, pid), 'Ödeme silindi'))}
          />

          <section className="card" aria-label="Kişisel kayıtlar">
            <div className="card__header">
              <h2 className="card__title">Kayıtlar</h2>
            </div>
            <FilterBar
              scope="personal"
              filters={active}
              onChange={(f) => setFilters(f)}
              tabLabels={PERSONAL_TAB_LABELS}
              counts={counts}
              exportDisabled={rows.length === 0}
              onExport={() => downloadCsv(`berk-${filters.tab}-${month}.csv`, entriesToCsv(rows, 'personal'))}
            />
            <div className="card__body card__body--flush">
              {paying && (
                <div className="fin-inline">
                  <MarkPaidForm entry={paying} today={today} busy={busy} onCancel={() => setPaying(null)} onConfirm={(paidOn) => void act(() => personalFinanceApi.status(paying.id, 'paid', paidOn), 'Ödendi olarak işaretlendi').then((ok) => ok && setPaying(null))} />
                </div>
              )}
              {entries.length === 0 ? (
                <EmptyState icon={PiggyBank} title="Henüz kişisel kayıt yok" description="Gelir veya harcama ekleyerek başla. Örnek veya tahmini tutar gösterilmez." action={<button type="button" className="button button--secondary button--sm" onClick={() => setForm({ id: null })}><Plus size={14} aria-hidden="true" /> Yeni Kayıt</button>} />
              ) : rows.length === 0 ? (
                <p className="dash-empty">{filters.tab === 'pending' || filters.tab === 'upcoming' ? 'Açık kayıt yok.' : `${formatMonth(month)} için bu filtrelerle kayıt yok.`}</p>
              ) : (
                <EntryList scope="personal" rows={rows} all={entries} today={today} onOpen={(e) => setForm({ id: e.id })} onMarkPaid={setPaying} onNext={(e) => void act(() => personalFinanceApi.next(e.id), 'Sonraki dönem eklendi')} />
              )}
            </div>
          </section>
        </>
      )}

      <Drawer open={form !== null} onClose={() => setForm(null)} title={editing ? 'Kaydı düzenle' : 'Yeni kişisel kayıt'} width="md">
        {form && (form.id === null || editing) && (
          <EntryForm
            key={form.id ?? 'new'}
            scope="personal"
            entry={editing}
            today={today}
            defaultKind="expense"
            onCancel={() => setForm(null)}
            onSave={async (input) => {
              const { companyId: _c, customerId: _u, ...personal } = input;
              await mutate(() => (editing ? personalFinanceApi.update(editing.id, personal) : personalFinanceApi.create(personal)));
              showToast({ title: editing ? 'Kayıt güncellendi' : 'Kayıt eklendi', description: input.title });
              setForm(null);
            }}
            onStatus={async (to) => {
              await mutate(() => personalFinanceApi.status(editing!.id, to));
              showToast({ title: to === 'cancelled' ? 'Kayıt iptal edildi' : 'Kayıt Bekliyor durumuna alındı' });
              setForm(null);
            }}
            onDelete={async () => {
              await mutate(() => personalFinanceApi.remove(editing!.id));
              showToast({ title: 'Kayıt silindi' });
              setForm(null);
            }}
          />
        )}
      </Drawer>

      <Drawer open={debtForm !== null} onClose={() => setDebtForm(null)} title={editingDebt ? 'Borcu düzenle' : 'Yeni borç'} width="md">
        {debtForm && (debtForm.id === null || editingDebt) && (
          <DebtForm
            key={debtForm.id ?? 'new'}
            debt={editingDebt as PersonalDebt | null}
            today={today}
            onCancel={() => setDebtForm(null)}
            onSave={async (input) => {
              await mutate(() => (editingDebt ? personalFinanceApi.updateDebt(editingDebt.id, input) : personalFinanceApi.createDebt(input)));
              showToast({ title: editingDebt ? 'Borç güncellendi' : 'Borç eklendi', description: input.creditor });
              setDebtForm(null);
            }}
            onDelete={async () => {
              await mutate(() => personalFinanceApi.removeDebt(editingDebt!.id));
              showToast({ title: 'Borç silindi' });
              setDebtForm(null);
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

/** Standing monthly spending target per currency; spent = paid personal expenses of the month. */
function BudgetCard({ data, month, view, busy, onSet }: { data: PersonalFinanceData; month: string; view: ReturnType<typeof personalMonthView>; busy: boolean; onSet: (c: FinanceCurrency, v: number | null) => Promise<boolean> }) {
  const [editing, setEditing] = useState<FinanceCurrency | 'new' | null>(null);
  const [currency, setCurrency] = useState<FinanceCurrency>('TRY');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const free = FINANCE_CURRENCIES.filter((c) => !data.budgets.some((b) => b.currency === c));

  const start = (c: FinanceCurrency | 'new') => {
    const existing = c === 'new' ? null : data.budgets.find((b) => b.currency === c);
    setCurrency(c === 'new' ? (free[0] ?? 'TRY') : c);
    setAmount(existing ? minorToInput(existing.monthlyLimitMinor) : '');
    setError(null);
    setEditing(c);
  };
  const save = async () => {
    const minor = parseAmountToMinor(amount, FINANCE_MAX_AMOUNT_MINOR);
    if (!minor) return setError('Bütçeyi sıfırdan büyük bir sayı olarak yaz.');
    if (await onSet(currency, minor)) setEditing(null);
  };

  return (
    <section className="card" aria-labelledby="fin-budget-title">
      <div className="card__header">
        <h2 className="card__title" id="fin-budget-title">
          Aylık bütçe · {formatMonth(month)}
        </h2>
        {editing === null && free.length > 0 && (
          <button type="button" className="button button--secondary button--sm" onClick={() => start('new')}>
            <Plus size={14} aria-hidden="true" /> Bütçe ekle
          </button>
        )}
      </div>
      <div className="card__body">
        {view.budgets.length === 0 && editing === null && <p className="dash-empty dash-empty--inline">Bütçe belirlenmedi. Para birimi başına aylık harcama hedefi ekleyebilirsin.</p>}
        {view.budgets.length > 0 && (
          <ul className="fin-budgets">
            {view.budgets.map((b) => {
              const pct = Math.min(100, Math.round((b.spentMinor / b.limitMinor) * 100));
              const over = b.remainingMinor < 0;
              return (
                <li key={b.currency} className="fin-budget">
                  <div className="fin-budget__head">
                    <strong>{b.currency}</strong>
                    <span>
                      Bütçe {formatAmount(b.limitMinor, b.currency)} · Harcanan {formatAmount(b.spentMinor, b.currency)} ·{' '}
                      <span className={over ? 'fin-budget__over' : 'fin-budget__left'}>{over ? `Aşıldı: ${formatAmount(-b.remainingMinor, b.currency)}` : `Kalan ${formatAmount(b.remainingMinor, b.currency)}`}</span>
                    </span>
                    <button type="button" className="button button--ghost button--sm" onClick={() => start(b.currency)} disabled={busy}>
                      Düzenle
                    </button>
                  </div>
                  <div className={over ? 'fin-progress fin-progress--over' : 'fin-progress'} role="progressbar" aria-label={`${b.currency} bütçe kullanımı`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {editing !== null && (
          <form
            className="sales-form sales-form--inline fin-budget-form"
            aria-label="Bütçe"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="sales-form__grid">
              <label className="field">
                <span className="field__label">Para birimi</span>
                <select className="input" value={currency} disabled={editing !== 'new'} onChange={(e) => setCurrency(e.target.value as FinanceCurrency)}>
                  {(editing === 'new' ? free : [currency]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Aylık harcama bütçesi</span>
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="40.000" autoFocus />
              </label>
            </div>
            {error && (
              <p className="research-alert research-alert--error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="submit" className="button button--primary button--sm" disabled={busy}>
                Kaydet
              </button>
              {editing !== 'new' && (
                <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void onSet(currency, null).then((ok) => ok && setEditing(null))}>
                  Bütçeyi kaldır
                </button>
              )}
              <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(null)} disabled={busy}>
                Vazgeç
              </button>
            </div>
          </form>
        )}
        <p className="sales-hint">Bütçe her ay için geçerli bir hedeftir; harcanan tutar o ayın ödenmiş harcamalarıdır (borç ödemeleri ayrı gösterilir).</p>
      </div>
    </section>
  );
}
