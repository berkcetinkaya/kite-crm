// KITE Finans (schema v9): agency income, expenses and money expected in or out. Manual and local:
// no bank sync, invoices, tax or exchange rates. Every total is shown per currency.
import { useCallback, useState } from 'react';
import { Plus, RefreshCw, Wallet } from 'lucide-react';
import { kiteFinanceApi } from '../../api/financeApi';
import { errorMessage } from '../../api/dataApi';
import { Drawer } from '../../components/ui/Drawer';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import {
  entriesToCsv,
  filterEntries,
  formatMonth,
  KITE_TAB_LABELS,
  monthOf,
  monthSummary,
  openPosition,
  recurringCommitments,
  todayKey,
  type FinanceFilters,
  type KiteFinanceEntry,
} from '../../domain/finance';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { CompanyDrawer } from '../prospects/detail/CompanyDrawer';
import { EntryForm } from './EntryForm';
import { downloadCsv, EntryList, FilterBar, MarkPaidForm, Money, MonthSwitcher, SummaryTile, tabCounts } from './shared';
import { useFinanceData } from './useFinanceData';
import '../sales/sales.css';
import '../tasks/tasks.css';
import './finance.css';

const CLIENTS_ROUTE = '#/clients';

export function KiteFinancePage() {
  const { data, loading, error, reload, mutate } = useFinanceData(useCallback((s: AbortSignal) => kiteFinanceApi.load(s), []));
  const { companies } = useCompanies();
  const showToast = useToast();
  const today = todayKey();
  const [month, setMonth] = useState(monthOf(today));
  const [filters, setFilters] = useState<FinanceFilters>({ tab: 'all', month: null, currency: null, category: null, status: null, kind: null });
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [paying, setPaying] = useState<KiteFinanceEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [companyOpen, setCompanyOpen] = useState<string | null>(null);

  const entries = data?.entries ?? [];
  const active = { ...filters, month };
  const rows = filterEntries(entries, active, today);
  const counts = tabCounts(entries, active, today, filterEntries);
  const summary = monthSummary(entries, month);
  const position = openPosition(entries, today);
  const recurring = recurringCommitments(entries, 'expense');
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name : undefined);
  const editing = form?.id ? entries.find((e) => e.id === form.id) ?? null : null;

  const linkOf = (e: KiteFinanceEntry) => {
    const name = companyName(e.companyId);
    if (!e.companyId) return null;
    if (e.customerId)
      return (
        <a className="link-cell" href={`${CLIENTS_ROUTE}?customer=${e.customerId}`}>
          {name ?? 'Müşteri'} <span className="text-subtle">· müşteri</span>
        </a>
      );
    return (
      <button type="button" className="link-cell" onClick={() => setCompanyOpen(e.companyId)}>
        {name ?? 'Şirket'}
      </button>
    );
  };

  const act = async (fn: () => Promise<unknown>, toast: string) => {
    setBusy(true);
    try {
      await mutate(fn as () => Promise<NonNullable<typeof data>>);
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
          <h1 className="page-header__title">KITE Finans</h1>
          <p className="page-header__subtitle">Ajans gelirleri, giderleri ve beklenen tahsilat / ödemeler. Para birimleri ayrı tutulur; kur çevrimi yapılmaz.</p>
        </div>
        <div className="tasks-page__tools">
          <button type="button" className="button button--ghost button--sm" onClick={() => void reload()} disabled={loading} aria-label="Yenile">
            <RefreshCw size={14} aria-hidden="true" className={loading ? 'spin' : undefined} /> Yenile
          </button>
          <button type="button" className="button button--primary" onClick={() => setForm({ id: null })} disabled={!data}>
            <Plus size={16} aria-hidden="true" /> Yeni Kayıt
          </button>
        </div>
      </header>

      {error && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          KITE Finans yüklenemedi: {error}
        </p>
      )}

      {!data ? (
        !error && <p className="dash-empty" aria-busy="true">Finans kayıtları yükleniyor…</p>
      ) : (
        <>
          <section className="card fin-summary" aria-label="Aylık özet">
            <div className="fin-summary__head">
              <MonthSwitcher month={month} onChange={setMonth} current={monthOf(today)} />
            </div>
            <div className="fin-tiles">
              <SummaryTile label="Gelir" totals={summary.income} tone="in" hint="Bu ay tahsil edilen" />
              <SummaryTile label="Gider" totals={summary.expense} tone="out" hint="Bu ay ödenen" />
              <SummaryTile label="Beklenen Tahsilat" totals={summary.receivable} tone="pending" hint="Vadesi bu ay" />
              <SummaryTile label="Beklenen Ödeme" totals={summary.payable} tone="pending" hint="Vadesi bu ay" />
            </div>
            <dl className="fin-position">
              <div>
                <dt>Açık tahsilat (tüm aylar)</dt>
                <dd>
                  <Money totals={position.receivable} />
                  {position.overdueReceivable.length > 0 && (
                    <span className="fin-position__warn">
                      Geciken: <Money totals={position.overdueReceivable} />
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Açık ödeme (tüm aylar)</dt>
                <dd>
                  <Money totals={position.payable} />
                </dd>
              </div>
              <div>
                <dt>Beklenen net (para birimi bazında)</dt>
                <dd>
                  <Money totals={position.net} signed />
                </dd>
              </div>
              <div>
                <dt>Tekrarlanan giderler</dt>
                <dd>
                  {recurring.monthly.length === 0 && recurring.yearly.length === 0 ? (
                    <Money totals={[]} />
                  ) : (
                    <>
                      {recurring.monthly.length > 0 && (
                        <span>
                          <Money totals={recurring.monthly} /> / ay
                        </span>
                      )}
                      {recurring.yearly.length > 0 && (
                        <span>
                          <Money totals={recurring.yearly} /> / yıl
                        </span>
                      )}
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="card" aria-label="Finans kayıtları">
            <FilterBar
              scope="kite"
              filters={active}
              onChange={(f) => setFilters(f)}
              tabLabels={KITE_TAB_LABELS}
              counts={counts}
              exportDisabled={rows.length === 0}
              onExport={() => downloadCsv(`kite-finans-${filters.tab}-${month}.csv`, entriesToCsv(rows.map((e) => ({ ...e, linkName: companyName(e.companyId) })), 'kite'))}
            />
            <div className="card__body card__body--flush">
              {paying && (
                <div className="fin-inline">
                  <MarkPaidForm
                    entry={paying}
                    today={today}
                    busy={busy}
                    onCancel={() => setPaying(null)}
                    onConfirm={(paidOn) =>
                      void act(() => kiteFinanceApi.status(paying.id, 'paid', paidOn), paying.direction === 'income' ? 'Tahsil edildi olarak işaretlendi' : 'Ödendi olarak işaretlendi').then((ok) => ok && setPaying(null))
                    }
                  />
                </div>
              )}
              {entries.length === 0 ? (
                <EmptyState icon={Wallet} title="Henüz finans kaydı yok" description="Gelir, gider veya beklenen bir tahsilat ekleyerek başla. Örnek veya tahmini tutar gösterilmez." action={<button type="button" className="button button--secondary button--sm" onClick={() => setForm({ id: null })}><Plus size={14} aria-hidden="true" /> Yeni Kayıt</button>} />
              ) : rows.length === 0 ? (
                <p className="dash-empty">{filters.tab === 'pending' || filters.tab === 'upcoming' ? 'Açık kayıt yok.' : `${formatMonth(month)} için bu filtrelerle kayıt yok.`}</p>
              ) : (
                <EntryList scope="kite" rows={rows} all={entries} today={today} linkOf={linkOf} onOpen={(e) => setForm({ id: e.id })} onMarkPaid={setPaying} onNext={(e) => void act(() => kiteFinanceApi.next(e.id), 'Sonraki dönem eklendi')} />
              )}
            </div>
          </section>
        </>
      )}

      <Drawer open={form !== null} onClose={() => setForm(null)} title={editing ? 'Kaydı düzenle' : 'Yeni finans kaydı'} width="md">
        {form && (form.id === null || editing) && (
          <EntryForm
            key={form.id ?? 'new'}
            scope="kite"
            entry={editing}
            today={today}
            onCancel={() => setForm(null)}
            onSave={async (input) => {
              await mutate(() => (editing ? kiteFinanceApi.update(editing.id, input) : kiteFinanceApi.create(input)));
              showToast({ title: editing ? 'Kayıt güncellendi' : 'Kayıt eklendi', description: input.title });
              setForm(null);
            }}
            onStatus={async (to) => {
              await mutate(() => kiteFinanceApi.status(editing!.id, to));
              showToast({ title: to === 'cancelled' ? 'Kayıt iptal edildi' : 'Kayıt Bekliyor durumuna alındı' });
              setForm(null);
            }}
            onDelete={async () => {
              await mutate(() => kiteFinanceApi.remove(editing!.id));
              showToast({ title: 'Kayıt silindi' });
              setForm(null);
            }}
          />
        )}
      </Drawer>

      <CompanyDrawer companyId={companyOpen} onClose={() => setCompanyOpen(null)} />
    </div>
  );
}
