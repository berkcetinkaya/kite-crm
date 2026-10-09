// Finance service (schema v9): KITE Finans and Berk. Two separate services over two separate
// repositories; neither reads or writes the other, and neither writes CRM records or company history.
//
// Rules enforced here (the browser only mirrors them):
//   - One row per money movement: Bekliyor → Ödendi keeps the row and its due date, sets paid_on/paid_at.
//   - Amounts are positive integer minor units in one currency; nothing is converted or combined.
//   - A recurring item never repeats on its own: "Sonraki dönemi oluştur" adds exactly one next
//     occurrence (pending), and refuses when that occurrence already exists.
//   - KITE links are optional; a customer link always carries the customer's company.
//   - Debt repayments can never exceed the remaining balance; the principal can never drop below
//     what is already repaid. A fully repaid debt is closed; removing a repayment reopens it.
//   - No secrets: card numbers, passwords, PINs, keys, tokens and seed phrases are refused.
import {
  containsFinanceSecret,
  debtPaid,
  FINANCE_ERROR_MESSAGES,
  isDayKey,
  KITE_CATEGORIES,
  kindParts,
  nextOccurrenceDays,
  PERSONAL_CATEGORIES,
  todayKey,
  type DebtPayment,
  type DebtPaymentInput,
  type FinanceCurrency,
  type FinanceEntry,
  type FinanceEntryInput,
  type FinanceErrorCode,
  type FinanceStatus,
  type KiteFinanceEntry,
  type KiteFinanceEntryInput,
  type PersonalBudget,
  type PersonalDebt,
  type PersonalDebtInput,
  type PersonalFinanceData,
} from '../../src/domain/finance';
import { createId } from '../../src/lib/id';
import type { Store } from '../db/store';

const HTTP: Record<FinanceErrorCode, number> = {
  finance_not_found: 404,
  finance_invalid: 400,
  finance_secret: 400,
  finance_link_invalid: 400,
  finance_invalid_transition: 409,
  finance_recurrence: 409,
  debt_overpayment: 409,
};

export class FinanceError extends Error {
  readonly status: number;
  constructor(
    public readonly code: FinanceErrorCode,
    message?: string,
  ) {
    super(message ?? FINANCE_ERROR_MESSAGES[code]);
    this.name = 'FinanceError';
    this.status = HTTP[code];
  }
}

const invalid = (message: string) => new FinanceError('finance_invalid', message);
const day = (v: string, label: string) => {
  if (!isDayKey(v)) throw invalid(`${label} geçerli bir tarih değil.`);
  return v;
};
const noSecrets = (...texts: (string | null | undefined)[]) => {
  if (texts.some(containsFinanceSecret)) throw new FinanceError('finance_secret');
};

interface Deps {
  now?: () => Date;
}

/** Shared lifecycle for both entry tables (they differ only in links and categories). */
function entryRules(scope: 'kite' | 'personal', deps: Deps) {
  const nowIso = () => (deps.now?.() ?? new Date()).toISOString();
  const categories = scope === 'kite' ? KITE_CATEGORIES : PERSONAL_CATEGORIES;

  /** Validated, normalised fields of an input (status and paid fields included). */
  function fields(input: FinanceEntryInput, current: FinanceEntry | null, at: string) {
    const title = input.title.trim();
    const notes = input.notes.trim();
    const counterparty = input.counterparty.trim();
    if (!title) throw invalid('Başlık yaz.');
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw invalid('Tutar sıfırdan büyük olmalı.');
    if (!(input.category in categories)) throw invalid('Kategori geçersiz.');
    noSecrets(title, notes, counterparty);
    const date = day(input.date, 'Tarih');
    const dueDate = input.dueDate ? day(input.dueDate, 'Vade') : null;
    const { direction, status } = kindParts(input.kind);
    // A cancelled row is reactivated only through the status endpoint.
    if (current?.status === 'cancelled') throw new FinanceError('finance_invalid_transition', 'İptal edilmiş kaydı düzenlemek için önce yeniden aç.');
    const paidOn = status === 'paid' ? (input.paidOn ? day(input.paidOn, 'Ödeme tarihi') : (current?.paidOn ?? date)) : null;
    const paidAt = status === 'paid' ? (current?.status === 'paid' ? current.paidAt : at) : null;
    return { direction, status, title, notes, counterparty, amountMinor: input.amountMinor, currency: input.currency, category: input.category, date, dueDate, recurrence: input.recurrence, paidOn, paidAt, cancelledAt: null };
  }

  function create<T extends FinanceEntry>(input: FinanceEntryInput, extra: Omit<T, keyof FinanceEntry>): T {
    const at = nowIso();
    const id = createId(scope === 'kite' ? 'kfe' : 'pfe');
    return { id, seriesId: id, ...fields(input, null, at), ...extra, createdAt: at, updatedAt: at } as T;
  }

  function update<T extends FinanceEntry>(current: T, input: FinanceEntryInput, extra: Partial<T>): T {
    const at = nowIso();
    return { ...current, ...fields(input, current, at), ...extra, updatedAt: at };
  }

  /** Bekliyor ↔ Ödendi, Bekliyor → İptal, İptal → Bekliyor. */
  function changeStatus<T extends FinanceEntry>(current: T, to: FinanceStatus, paidOn: string | null): T {
    const at = nowIso();
    const allowed: Record<FinanceStatus, FinanceStatus[]> = { pending: ['paid', 'cancelled'], paid: ['pending'], cancelled: ['pending'] };
    if (!allowed[current.status].includes(to)) throw new FinanceError('finance_invalid_transition');
    if (to === 'paid') return { ...current, status: to, paidOn: paidOn ? day(paidOn, 'Ödeme tarihi') : todayKey(at), paidAt: at, cancelledAt: null, updatedAt: at };
    if (to === 'cancelled') return { ...current, status: to, paidOn: null, paidAt: null, cancelledAt: at, updatedAt: at };
    return { ...current, status: to, paidOn: null, paidAt: null, cancelledAt: null, updatedAt: at };
  }

  /** The next occurrence of a recurring item: a new pending row in the same series. */
  function next<T extends FinanceEntry>(current: T, exists: (seriesId: string, date: string) => boolean): T {
    const days = nextOccurrenceDays(current);
    if (!days) throw new FinanceError('finance_recurrence', 'Bu kayıt tekrarlanan bir kayıt değil.');
    if (current.status === 'cancelled') throw new FinanceError('finance_recurrence', 'İptal edilmiş kaydın sonraki dönemi oluşturulamaz.');
    if (exists(current.seriesId, days.date)) throw new FinanceError('finance_recurrence', 'Sonraki dönem zaten oluşturulmuş.');
    const at = nowIso();
    return { ...current, id: createId(scope === 'kite' ? 'kfe' : 'pfe'), ...days, status: 'pending', paidOn: null, paidAt: null, cancelledAt: null, createdAt: at, updatedAt: at };
  }

  return { create, update, changeStatus, next, nowIso };
}

export function createKiteFinanceService(store: Store, deps: Deps = {}) {
  const rules = entryRules('kite', deps);

  function entryOf(id: string): KiteFinanceEntry {
    const e = store.kiteFinance.get(id);
    if (!e) throw new FinanceError('finance_not_found');
    return e;
  }

  /** Optional CRM link; a customer always brings its company. Reads CRM, never writes it. */
  function links(input: Pick<KiteFinanceEntryInput, 'companyId' | 'customerId'>) {
    if (input.customerId) {
      const customer = store.customers.get(input.customerId);
      if (!customer || (input.companyId && input.companyId !== customer.companyId)) throw new FinanceError('finance_link_invalid');
      return { companyId: customer.companyId, customerId: customer.id };
    }
    if (input.companyId && !store.companies.get(input.companyId)) throw new FinanceError('finance_link_invalid');
    return { companyId: input.companyId ?? null, customerId: null };
  }

  return {
    list: () => ({ entries: store.kiteFinance.list() }),
    create: (input: KiteFinanceEntryInput) =>
      store.transaction(() => {
        const e = rules.create<KiteFinanceEntry>(input, links(input));
        store.kiteFinance.save(e);
        return e;
      }),
    update: (id: string, input: KiteFinanceEntryInput) =>
      store.transaction(() => {
        const e = rules.update(entryOf(id), input, links(input));
        store.kiteFinance.save(e);
        return e;
      }),
    changeStatus: (id: string, to: FinanceStatus, paidOn: string | null) =>
      store.transaction(() => {
        const e = rules.changeStatus(entryOf(id), to, paidOn);
        store.kiteFinance.save(e);
        return e;
      }),
    createNext: (id: string) =>
      store.transaction(() => {
        const e = rules.next(entryOf(id), store.kiteFinance.existsInSeries);
        store.kiteFinance.save(e);
        return e;
      }),
    delete: (id: string) =>
      store.transaction(() => {
        entryOf(id);
        store.kiteFinance.delete(id);
      }),
  };
}

export function createPersonalFinanceService(store: Store, deps: Deps = {}) {
  const rules = entryRules('personal', deps);
  const repo = () => store.personalFinance;

  function entryOf(id: string) {
    const e = repo().getEntry(id);
    if (!e) throw new FinanceError('finance_not_found');
    return e;
  }
  function debtOf(id: string): PersonalDebt {
    const d = repo().getDebt(id);
    if (!d) throw new FinanceError('finance_not_found', 'Borç kaydı bulunamadı.');
    return d;
  }

  function debtFields(input: PersonalDebtInput) {
    const creditor = input.creditor.trim();
    const notes = input.notes.trim();
    if (!creditor) throw invalid('Kime borçlu olduğunu yaz.');
    if (!Number.isSafeInteger(input.principalMinor) || input.principalMinor <= 0) throw invalid('Toplam borç sıfırdan büyük olmalı.');
    if (input.installmentMinor !== null && (!Number.isSafeInteger(input.installmentMinor) || input.installmentMinor <= 0)) throw invalid('Taksit tutarı geçersiz.');
    noSecrets(creditor, notes);
    return {
      creditor,
      notes,
      currency: input.currency,
      principalMinor: input.principalMinor,
      startDate: day(input.startDate, 'Başlangıç tarihi'),
      nextDueDate: input.nextDueDate ? day(input.nextDueDate, 'Sonraki ödeme tarihi') : null,
      installmentMinor: input.installmentMinor,
    };
  }

  /** closed_at follows the balance: set when it reaches zero, cleared when it is open again. */
  const withClosure = (d: PersonalDebt, at: string): PersonalDebt => {
    const open = d.principalMinor - debtPaid(d) > 0;
    return { ...d, closedAt: open ? null : (d.closedAt ?? at), nextDueDate: open ? d.nextDueDate : null };
  };

  return {
    list: (): PersonalFinanceData => ({ entries: repo().listEntries(), debts: repo().listDebts(), budgets: repo().listBudgets() }),

    createEntry: (input: FinanceEntryInput) =>
      store.transaction(() => {
        const e = rules.create<FinanceEntry>(input, {});
        repo().saveEntry(e);
        return e;
      }),
    updateEntry: (id: string, input: FinanceEntryInput) =>
      store.transaction(() => {
        const e = rules.update(entryOf(id), input, {});
        repo().saveEntry(e);
        return e;
      }),
    changeEntryStatus: (id: string, to: FinanceStatus, paidOn: string | null) =>
      store.transaction(() => {
        const e = rules.changeStatus(entryOf(id), to, paidOn);
        repo().saveEntry(e);
        return e;
      }),
    createNextEntry: (id: string) =>
      store.transaction(() => {
        const e = rules.next(entryOf(id), repo().existsInSeries);
        repo().saveEntry(e);
        return e;
      }),
    deleteEntry: (id: string) =>
      store.transaction(() => {
        entryOf(id);
        repo().deleteEntry(id);
      }),

    createDebt: (input: PersonalDebtInput) =>
      store.transaction(() => {
        const at = rules.nowIso();
        const d: PersonalDebt = { id: createId('dbt'), ...debtFields(input), createdAt: at, updatedAt: at, closedAt: null, payments: [] };
        repo().saveDebt(d);
        return debtOf(d.id);
      }),
    updateDebt: (id: string, input: PersonalDebtInput) =>
      store.transaction(() => {
        const current = debtOf(id);
        const f = debtFields(input);
        const paid = debtPaid(current);
        if (f.principalMinor < paid) throw invalid('Toplam borç, şimdiye kadar ödenenden az olamaz.');
        if (f.currency !== current.currency && current.payments.length) throw invalid('Ödeme yapılmış borcun para birimi değiştirilemez.');
        const at = rules.nowIso();
        repo().saveDebt(withClosure({ ...current, ...f, updatedAt: at }, at));
        return debtOf(id);
      }),
    deleteDebt: (id: string) =>
      store.transaction(() => {
        debtOf(id);
        repo().deleteDebt(id);
      }),
    addPayment: (debtId: string, input: DebtPaymentInput) =>
      store.transaction(() => {
        const debt = debtOf(debtId);
        if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw invalid('Ödeme tutarı sıfırdan büyük olmalı.');
        const notes = input.notes.trim();
        noSecrets(notes);
        if (input.amountMinor > debt.principalMinor - debtPaid(debt)) throw new FinanceError('debt_overpayment');
        const at = rules.nowIso();
        const payment: DebtPayment = { id: createId('dpy'), debtId, amountMinor: input.amountMinor, paidOn: day(input.paidOn, 'Ödeme tarihi'), notes, createdAt: at };
        repo().insertPayment(payment);
        const nextDueDate = input.nextDueDate === undefined ? debt.nextDueDate : input.nextDueDate ? day(input.nextDueDate, 'Sonraki ödeme tarihi') : null;
        repo().saveDebt(withClosure({ ...debt, nextDueDate, payments: [...debt.payments, payment], updatedAt: at }, at));
        return debtOf(debtId);
      }),
    deletePayment: (debtId: string, paymentId: string) =>
      store.transaction(() => {
        const debt = debtOf(debtId);
        const p = repo().getPayment(paymentId);
        if (!p || p.debtId !== debtId) throw new FinanceError('finance_not_found', 'Ödeme bulunamadı.');
        repo().deletePayment(paymentId);
        const at = rules.nowIso();
        repo().saveDebt(withClosure({ ...debt, payments: debt.payments.filter((x) => x.id !== paymentId), updatedAt: at }, at));
        return debtOf(debtId);
      }),

    /** null removes the budget of that currency. */
    setBudget: (currency: FinanceCurrency, monthlyLimitMinor: number | null): PersonalBudget[] =>
      store.transaction(() => {
        if (monthlyLimitMinor === null) repo().deleteBudget(currency);
        else {
          if (!Number.isSafeInteger(monthlyLimitMinor) || monthlyLimitMinor <= 0) throw invalid('Bütçe sıfırdan büyük olmalı.');
          repo().saveBudget({ currency, monthlyLimitMinor, updatedAt: rules.nowIso() });
        }
        return repo().listBudgets();
      }),
  };
}

export type KiteFinanceServiceApi = ReturnType<typeof createKiteFinanceService>;
export type PersonalFinanceServiceApi = ReturnType<typeof createPersonalFinanceService>;
