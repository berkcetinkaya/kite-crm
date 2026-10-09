// SQLite repositories for finance (schema v9). KITE Finans and Berk use separate tables and separate
// repositories; nothing here reads or writes the other side or any CRM table.
import type { DebtPayment, FinanceEntry, KiteFinanceEntry, PersonalBudget, PersonalDebt, PersonalFinanceEntry } from '../../../src/domain/finance';
import type { Db } from '../sqlite';
import type { KiteFinanceRepository, PersonalFinanceRepository } from './types';

type Row = Record<string, unknown>;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const toEntry = (r: Row): FinanceEntry => ({
  id: r.id as string,
  direction: r.direction as FinanceEntry['direction'],
  title: r.title as string,
  notes: r.notes as string,
  counterparty: r.counterparty as string,
  amountMinor: Number(r.amount_minor),
  currency: r.currency as FinanceEntry['currency'],
  category: r.category as string,
  date: r.entry_date as string,
  dueDate: sn(r.due_date),
  status: r.status as FinanceEntry['status'],
  recurrence: r.recurrence as FinanceEntry['recurrence'],
  seriesId: r.series_id as string,
  paidOn: sn(r.paid_on),
  paidAt: sn(r.paid_at),
  cancelledAt: sn(r.cancelled_at),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const entryParams = (e: FinanceEntry) => ({
  id: e.id,
  direction: e.direction,
  title: e.title,
  notes: e.notes,
  counterparty: e.counterparty,
  amount_minor: e.amountMinor,
  currency: e.currency,
  category: e.category,
  entry_date: e.date,
  due_date: e.dueDate,
  status: e.status,
  recurrence: e.recurrence,
  series_id: e.seriesId,
  paid_on: e.paidOn,
  paid_at: e.paidAt,
  cancelled_at: e.cancelledAt,
  created_at: e.createdAt,
  updated_at: e.updatedAt,
});

const ENTRY_COLS = 'id, direction, title, notes, counterparty, amount_minor, currency, category, entry_date, due_date, status, recurrence, series_id, paid_on, paid_at, cancelled_at, created_at, updated_at';
const ENTRY_UPDATE = `direction = excluded.direction, title = excluded.title, notes = excluded.notes, counterparty = excluded.counterparty,
  amount_minor = excluded.amount_minor, currency = excluded.currency, category = excluded.category, entry_date = excluded.entry_date,
  due_date = excluded.due_date, status = excluded.status, recurrence = excluded.recurrence, series_id = excluded.series_id,
  paid_on = excluded.paid_on, paid_at = excluded.paid_at, cancelled_at = excluded.cancelled_at, updated_at = excluded.updated_at`;
const placeholders = (cols: string) => cols.split(',').map((c) => `:${c.trim()}`).join(', ');

export function createKiteFinanceRepository(db: Db): KiteFinanceRepository {
  // Prepared on first use (the store may be built before migrations reach v9 in upgrade tests).
  let prepared: ReturnType<typeof prepare> | null = null;
  const cols = `${ENTRY_COLS}, company_id, customer_id`;
  const prepare = () => ({
    list: db.prepare('SELECT * FROM kite_finance_entries ORDER BY entry_date DESC, created_at DESC'),
    get: db.prepare('SELECT * FROM kite_finance_entries WHERE id = ?'),
    inSeries: db.prepare('SELECT COUNT(*) AS n FROM kite_finance_entries WHERE series_id = ? AND entry_date = ?'),
    upsert: db.prepare(`INSERT INTO kite_finance_entries (${cols}) VALUES (${placeholders(cols)})
      ON CONFLICT(id) DO UPDATE SET ${ENTRY_UPDATE}, company_id = excluded.company_id, customer_id = excluded.customer_id`),
    remove: db.prepare('DELETE FROM kite_finance_entries WHERE id = ?'),
  });
  const q = () => (prepared ??= prepare());
  const toKite = (r: Row): KiteFinanceEntry => ({ ...toEntry(r), companyId: sn(r.company_id), customerId: sn(r.customer_id) });

  return {
    list: () => (q().list.all() as Row[]).map(toKite),
    get(id) {
      const r = q().get.get(id) as Row | undefined;
      return r ? toKite(r) : null;
    },
    existsInSeries: (seriesId, date) => Number((q().inSeries.get(seriesId, date) as { n: number }).n) > 0,
    save(e) {
      q().upsert.run({ ...entryParams(e), company_id: e.companyId, customer_id: e.customerId });
    },
    delete(id) {
      return Number(q().remove.run(id).changes) > 0;
    },
  };
}

export function createPersonalFinanceRepository(db: Db): PersonalFinanceRepository {
  let prepared: ReturnType<typeof prepare> | null = null;
  const prepare = () => ({
    list: db.prepare('SELECT * FROM personal_finance_entries ORDER BY entry_date DESC, created_at DESC'),
    get: db.prepare('SELECT * FROM personal_finance_entries WHERE id = ?'),
    inSeries: db.prepare('SELECT COUNT(*) AS n FROM personal_finance_entries WHERE series_id = ? AND entry_date = ?'),
    upsert: db.prepare(`INSERT INTO personal_finance_entries (${ENTRY_COLS}) VALUES (${placeholders(ENTRY_COLS)})
      ON CONFLICT(id) DO UPDATE SET ${ENTRY_UPDATE}`),
    remove: db.prepare('DELETE FROM personal_finance_entries WHERE id = ?'),
    debts: db.prepare('SELECT * FROM personal_debts ORDER BY created_at'),
    debt: db.prepare('SELECT * FROM personal_debts WHERE id = ?'),
    payments: db.prepare('SELECT * FROM personal_debt_payments ORDER BY paid_on, created_at'),
    paymentsOf: db.prepare('SELECT * FROM personal_debt_payments WHERE debt_id = ? ORDER BY paid_on, created_at'),
    payment: db.prepare('SELECT * FROM personal_debt_payments WHERE id = ?'),
    upsertDebt: db.prepare(`INSERT INTO personal_debts (id, creditor, notes, currency, principal_minor, start_date, next_due_date, installment_minor, created_at, updated_at, closed_at)
      VALUES (:id, :creditor, :notes, :currency, :principal_minor, :start_date, :next_due_date, :installment_minor, :created_at, :updated_at, :closed_at)
      ON CONFLICT(id) DO UPDATE SET creditor = excluded.creditor, notes = excluded.notes, currency = excluded.currency, principal_minor = excluded.principal_minor,
      start_date = excluded.start_date, next_due_date = excluded.next_due_date, installment_minor = excluded.installment_minor,
      updated_at = excluded.updated_at, closed_at = excluded.closed_at`),
    removeDebt: db.prepare('DELETE FROM personal_debts WHERE id = ?'),
    insertPayment: db.prepare('INSERT INTO personal_debt_payments (id, debt_id, amount_minor, paid_on, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    removePayment: db.prepare('DELETE FROM personal_debt_payments WHERE id = ?'),
    budgets: db.prepare('SELECT * FROM personal_budgets'),
    upsertBudget: db.prepare(`INSERT INTO personal_budgets (currency, monthly_limit_minor, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(currency) DO UPDATE SET monthly_limit_minor = excluded.monthly_limit_minor, updated_at = excluded.updated_at`),
    removeBudget: db.prepare('DELETE FROM personal_budgets WHERE currency = ?'),
  });
  const q = () => (prepared ??= prepare());

  const toPayment = (r: Row): DebtPayment => ({
    id: r.id as string,
    debtId: r.debt_id as string,
    amountMinor: Number(r.amount_minor),
    paidOn: r.paid_on as string,
    notes: r.notes as string,
    createdAt: r.created_at as string,
  });
  const toDebt = (r: Row, payments: DebtPayment[]): PersonalDebt => ({
    id: r.id as string,
    creditor: r.creditor as string,
    notes: r.notes as string,
    currency: r.currency as PersonalDebt['currency'],
    principalMinor: Number(r.principal_minor),
    startDate: r.start_date as string,
    nextDueDate: sn(r.next_due_date),
    installmentMinor: nn(r.installment_minor),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    closedAt: sn(r.closed_at),
    payments,
  });

  return {
    listEntries: () => (q().list.all() as Row[]).map(toEntry) as PersonalFinanceEntry[],
    getEntry(id) {
      const r = q().get.get(id) as Row | undefined;
      return r ? toEntry(r) : null;
    },
    existsInSeries: (seriesId, date) => Number((q().inSeries.get(seriesId, date) as { n: number }).n) > 0,
    saveEntry(e) {
      q().upsert.run(entryParams(e));
    },
    deleteEntry(id) {
      return Number(q().remove.run(id).changes) > 0;
    },
    listDebts() {
      const byDebt = new Map<string, DebtPayment[]>();
      for (const p of (q().payments.all() as Row[]).map(toPayment)) byDebt.set(p.debtId, [...(byDebt.get(p.debtId) ?? []), p]);
      return (q().debts.all() as Row[]).map((r) => toDebt(r, byDebt.get(r.id as string) ?? []));
    },
    getDebt(id) {
      const r = q().debt.get(id) as Row | undefined;
      return r ? toDebt(r, (q().paymentsOf.all(id) as Row[]).map(toPayment)) : null;
    },
    saveDebt(d) {
      q().upsertDebt.run({
        id: d.id,
        creditor: d.creditor,
        notes: d.notes,
        currency: d.currency,
        principal_minor: d.principalMinor,
        start_date: d.startDate,
        next_due_date: d.nextDueDate,
        installment_minor: d.installmentMinor,
        created_at: d.createdAt,
        updated_at: d.updatedAt,
        closed_at: d.closedAt,
      });
    },
    deleteDebt(id) {
      return Number(q().removeDebt.run(id).changes) > 0;
    },
    getPayment(id) {
      const r = q().payment.get(id) as Row | undefined;
      return r ? toPayment(r) : null;
    },
    insertPayment(p) {
      q().insertPayment.run(p.id, p.debtId, p.amountMinor, p.paidOn, p.notes, p.createdAt);
    },
    deletePayment(id) {
      return Number(q().removePayment.run(id).changes) > 0;
    },
    listBudgets: () =>
      (q().budgets.all() as Row[]).map((r): PersonalBudget => ({ currency: r.currency as PersonalBudget['currency'], monthlyLimitMinor: Number(r.monthly_limit_minor), updatedAt: r.updated_at as string })),
    saveBudget(b) {
      q().upsertBudget.run(b.currency, b.monthlyLimitMinor, b.updatedAt);
    },
    deleteBudget(currency) {
      return Number(q().removeBudget.run(currency).changes) > 0;
    },
  };
}
