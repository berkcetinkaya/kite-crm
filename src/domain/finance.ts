// Finance (schema v9): two separate, lightweight money trackers.
//   - KITE Finans: agency income, expenses, expected receivables / payables, optional CRM link.
//   - Berk: personal income and spending, debts with repayments, monthly budgets per currency.
// Not accounting: no ledger, invoices, tax, bank sync or exchange rates. Amounts are integer minor
// units (kuruş / cent) and every total is kept per currency; currencies are never added together.
//
// One row is one money movement through its lifecycle: a pending receivable that gets paid stays the
// same row (status Bekliyor → Ödendi, paid_on / paid_at set, due date kept). The labels Gelir / Gider /
// Beklenen Tahsilat / Beklenen Ödeme are derived from direction + status.
//
// Dates are explicit calendar days ("YYYY-MM-DD") chosen by the user; "today" and month keys use the
// Istanbul business day, so nothing shifts with the browser or server time zone.
import { containsSecret, NO_SECRETS_WARNING } from './customers';
import { dayKey } from './businessDay';

// ---------- Enumerations (literal copies live in migration v9) ----------

export const FINANCE_CURRENCIES = ['TRY', 'USD', 'EUR', 'IDR'] as const;
export type FinanceCurrency = (typeof FINANCE_CURRENCIES)[number];

export const FINANCE_DIRECTIONS = ['income', 'expense'] as const;
export type FinanceDirection = (typeof FINANCE_DIRECTIONS)[number];

export const FINANCE_STATUSES = ['pending', 'paid', 'cancelled'] as const;
export type FinanceStatus = (typeof FINANCE_STATUSES)[number];
export const FINANCE_STATUS_LABELS: Record<FinanceStatus, string> = { pending: 'Bekliyor', paid: 'Ödendi', cancelled: 'İptal' };

export const RECURRENCES = ['none', 'monthly', 'yearly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const RECURRENCE_LABELS: Record<Recurrence, string> = { none: 'Tekrarlanmaz', monthly: 'Aylık', yearly: 'Yıllık' };

/** What the user picks in the form: direction + whether the money has moved yet. */
export const ENTRY_KINDS = ['income', 'expense', 'receivable', 'payable'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const KITE_KIND_LABELS: Record<EntryKind, string> = { income: 'Gelir', expense: 'Gider', receivable: 'Beklenen Tahsilat', payable: 'Beklenen Ödeme' };
export const PERSONAL_KIND_LABELS: Record<EntryKind, string> = { income: 'Gelir', expense: 'Harcama', receivable: 'Beklenen Gelir', payable: 'Beklenen Ödeme' };

export const kindParts = (kind: EntryKind): { direction: FinanceDirection; status: 'pending' | 'paid' } => ({
  direction: kind === 'income' || kind === 'receivable' ? 'income' : 'expense',
  status: kind === 'income' || kind === 'expense' ? 'paid' : 'pending',
});
/** A cancelled row keeps the label of what it was planned as (pending side). */
export const kindOf = (e: Pick<FinanceEntry, 'direction' | 'status'>): EntryKind =>
  e.direction === 'income' ? (e.status === 'paid' ? 'income' : 'receivable') : e.status === 'paid' ? 'expense' : 'payable';

// ---------- Categories (stored as keys; the list can grow without a migration) ----------

export const KITE_CATEGORIES = {
  client_payment: 'Müşteri Ödemesi',
  advertising: 'Reklam / Pazarlama',
  software: 'Yazılım',
  freelancer: 'Freelancer',
  tax: 'Vergi',
  office: 'Ofis / Operasyon',
  hosting: 'Domain / Hosting',
  subscription: 'Abonelik',
  other: 'Diğer',
} as const;
export type KiteCategory = keyof typeof KITE_CATEGORIES;

export const PERSONAL_CATEGORIES = {
  earnings: 'Kazanç',
  rent: 'Kira',
  motorcycle: 'Motor',
  groceries: 'Market',
  food: 'Yeme İçme',
  transport: 'Ulaşım',
  travel: 'Seyahat',
  family: 'Aile',
  debt: 'Borç',
  subscription: 'Abonelik',
  health: 'Sağlık',
  other: 'Diğer',
} as const;
export type PersonalCategory = keyof typeof PERSONAL_CATEGORIES;

export const categoryLabel = (scope: 'kite' | 'personal', key: string): string =>
  ((scope === 'kite' ? KITE_CATEGORIES : PERSONAL_CATEGORIES) as Record<string, string>)[key] ?? key;

// ---------- Records ----------

export interface FinanceEntry {
  id: string;
  direction: FinanceDirection;
  title: string;
  notes: string;
  /** Free text: who pays / gets paid when that is not (or not yet) a CRM company. */
  counterparty: string;
  amountMinor: number;
  currency: FinanceCurrency;
  category: string;
  /** Calendar day of the entry ("YYYY-MM-DD"). */
  date: string;
  dueDate: string | null;
  status: FinanceStatus;
  recurrence: Recurrence;
  /** Shared by every occurrence of a recurring item (the first occurrence's id). */
  seriesId: string;
  /** Calendar day the money actually moved; set only while paid. */
  paidOn: string | null;
  /** When it was marked paid. */
  paidAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KiteFinanceEntry extends FinanceEntry {
  companyId: string | null;
  /** When set, companyId is the customer's company. */
  customerId: string | null;
}

export type PersonalFinanceEntry = FinanceEntry;

export interface FinanceEntryInput {
  kind: EntryKind;
  title: string;
  notes: string;
  counterparty: string;
  amountMinor: number;
  currency: FinanceCurrency;
  category: string;
  date: string;
  dueDate: string | null;
  /** Only for paid kinds; defaults to the entry date. */
  paidOn: string | null;
  recurrence: Recurrence;
}

export interface KiteFinanceEntryInput extends FinanceEntryInput {
  companyId: string | null;
  customerId: string | null;
}

export interface DebtPayment {
  id: string;
  debtId: string;
  amountMinor: number;
  paidOn: string;
  notes: string;
  createdAt: string;
}

/** Money Berk owes (one record) and its repayments; the remaining balance is always derived. */
export interface PersonalDebt {
  id: string;
  creditor: string;
  notes: string;
  currency: FinanceCurrency;
  principalMinor: number;
  startDate: string;
  nextDueDate: string | null;
  /** Planned repayment per instalment (informational). */
  installmentMinor: number | null;
  createdAt: string;
  updatedAt: string;
  /** Set when fully repaid; cleared if a repayment is removed. */
  closedAt: string | null;
  /** Oldest first. */
  payments: DebtPayment[];
}

export interface PersonalDebtInput {
  creditor: string;
  notes: string;
  currency: FinanceCurrency;
  principalMinor: number;
  startDate: string;
  nextDueDate: string | null;
  installmentMinor: number | null;
}

export interface DebtPaymentInput {
  amountMinor: number;
  paidOn: string;
  notes: string;
  /** Optional new "Sonraki ödeme" date; null clears it, undefined keeps it. */
  nextDueDate?: string | null;
}

/** A standing monthly spending target for one currency. */
export interface PersonalBudget {
  currency: FinanceCurrency;
  monthlyLimitMinor: number;
  updatedAt: string;
}

export interface KiteFinanceData {
  entries: KiteFinanceEntry[];
}

export interface PersonalFinanceData {
  entries: PersonalFinanceEntry[];
  debts: PersonalDebt[];
  budgets: PersonalBudget[];
}

// ---------- Limits, errors, guards ----------

export const FINANCE_TITLE_MAX = 200;
export const FINANCE_NOTES_MAX = 2000;
export const FINANCE_COUNTERPARTY_MAX = 120;
/** One trillion in the main unit: large enough for IDR, small enough to stay a safe integer. */
export const FINANCE_MAX_AMOUNT_MINOR = 100_000_000_000_000;

export type FinanceErrorCode =
  | 'finance_not_found'
  | 'finance_invalid'
  | 'finance_secret'
  | 'finance_link_invalid'
  | 'finance_invalid_transition'
  | 'finance_recurrence'
  | 'debt_overpayment';

export const FINANCE_ERROR_MESSAGES: Record<FinanceErrorCode, string> = {
  finance_not_found: 'Kayıt bulunamadı.',
  finance_invalid: 'Bilgiler geçersiz.',
  finance_secret: `Kart numarası, şifre, PIN, API key, token veya kurtarma kelimeleri saklamayın. ${NO_SECRETS_WARNING}`,
  finance_link_invalid: 'Seçilen şirket veya müşteri bulunamadı ya da birbiriyle eşleşmiyor.',
  finance_invalid_transition: 'Bu kaydın durumu bu şekilde değiştirilemez.',
  finance_recurrence: 'Sonraki dönem oluşturulamadı.',
  debt_overpayment: 'Ödeme kalan borçtan fazla olamaz.',
};

/** Luhn check: catches pasted card numbers (13-19 digits, spaces or dashes allowed). */
function looksLikeCardNumber(text: string): boolean {
  for (const m of text.matchAll(/(?:\d[ -]?){12,18}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

const FINANCE_SECRET = /\b(?:pin|cvv|cvc|cvv2)\b\s*(?:kodu?|code)?\s*[:=]?\s*\d{3,6}\b|seed\s*phrase|mnemonic|recovery\s*phrase|kurtarma\s*(?:ifadesi|kelimeleri)|private\s*key|özel\s*anahtar/iu;

/** Credentials never belong in finance notes: passwords, keys, tokens, card numbers, PINs, seed phrases. */
export const containsFinanceSecret = (text: string | null | undefined): boolean =>
  !!text && (containsSecret(text) || FINANCE_SECRET.test(text) || looksLikeCardNumber(text));

// ---------- Dates ----------

export const isDayKey = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
export const isMonthKey = (v: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const todayKey = (now: Date | string = new Date()): string => dayKey(typeof now === 'string' ? now : now.toISOString());
export const monthOf = (day: string): string => day.slice(0, 7);

/** "2026-01-31" + 1 month → "2026-02-28" (clamped to the month end). */
export function addMonthsToDay(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
export const addMonthsToMonth = (month: string, months: number): string => addMonthsToDay(`${month}-01`, months).slice(0, 7);

const DAY_LABEL = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_LABEL_YEAR = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONTH_LABEL = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "15 Kas" (this year) or "15 Kas 2027". */
export const formatDay = (day: string, today = todayKey()): string =>
  (day.slice(0, 4) === today.slice(0, 4) ? DAY_LABEL : DAY_LABEL_YEAR).format(new Date(`${day}T00:00:00Z`));
export const formatMonth = (month: string): string => MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`));

// ---------- Money ----------

/** "TRY 42.000", "USD 850,50", "IDR 6.500.000" — currency code first, never converted. */
export function formatAmount(minor: number, currency: FinanceCurrency): string {
  const n = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(minor / 100);
  return `${currency} ${n}`;
}

/** Totals per currency, in FINANCE_CURRENCIES order, zero totals left out. */
export type CurrencyTotals = { currency: FinanceCurrency; amountMinor: number }[];

export function totalsByCurrency<T>(items: readonly T[], currency: (t: T) => FinanceCurrency, amount: (t: T) => number): CurrencyTotals {
  const sums = new Map<FinanceCurrency, number>();
  for (const i of items) sums.set(currency(i), (sums.get(currency(i)) ?? 0) + amount(i));
  return FINANCE_CURRENCIES.filter((c) => (sums.get(c) ?? 0) !== 0).map((c) => ({ currency: c, amountMinor: sums.get(c)! }));
}
const entryTotals = (entries: readonly FinanceEntry[]) => totalsByCurrency(entries, (e) => e.currency, (e) => e.amountMinor);

/** Same-currency difference a − b (a currency missing on one side counts as zero there). */
export function subtractTotals(a: CurrencyTotals, b: CurrencyTotals): CurrencyTotals {
  const all = new Map<FinanceCurrency, number>();
  for (const t of a) all.set(t.currency, (all.get(t.currency) ?? 0) + t.amountMinor);
  for (const t of b) all.set(t.currency, (all.get(t.currency) ?? 0) - t.amountMinor);
  return FINANCE_CURRENCIES.filter((c) => (all.get(c) ?? 0) !== 0).map((c) => ({ currency: c, amountMinor: all.get(c)! }));
}

// ---------- Views over entries ----------

/** The day an entry belongs to: when it was paid, otherwise when it is due (or its date). */
export const effectiveDay = (e: FinanceEntry): string => (e.status === 'paid' && e.paidOn ? e.paidOn : (e.dueDate ?? e.date));

export const UPCOMING_FINANCE_DAYS = 30;

/** Pending and due within the next 30 days, overdue included. */
export const isUpcoming = (e: FinanceEntry, today: string): boolean =>
  e.status === 'pending' && effectiveDay(e) <= addDaysToDay(today, UPCOMING_FINANCE_DAYS);
export const isOverdue = (e: FinanceEntry, today: string): boolean => e.status === 'pending' && effectiveDay(e) < today;

function addDaysToDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export interface MonthSummary {
  income: CurrencyTotals;
  expense: CurrencyTotals;
  /** Pending incoming money due in the month. */
  receivable: CurrencyTotals;
  /** Pending outgoing money due in the month. */
  payable: CurrencyTotals;
}

export function monthSummary(entries: readonly FinanceEntry[], month: string): MonthSummary {
  const inMonth = entries.filter((e) => e.status !== 'cancelled' && monthOf(effectiveDay(e)) === month);
  const pick = (direction: FinanceDirection, status: FinanceStatus) => entryTotals(inMonth.filter((e) => e.direction === direction && e.status === status));
  return { income: pick('income', 'paid'), expense: pick('expense', 'paid'), receivable: pick('income', 'pending'), payable: pick('expense', 'pending') };
}

export interface OpenPosition {
  receivable: CurrencyTotals;
  payable: CurrencyTotals;
  /** receivable − payable, per currency. */
  net: CurrencyTotals;
  overdueReceivable: CurrencyTotals;
}

/** Every pending item regardless of month: the expected cash position by currency. */
export function openPosition(entries: readonly FinanceEntry[], today: string): OpenPosition {
  const pending = entries.filter((e) => e.status === 'pending');
  const receivable = entryTotals(pending.filter((e) => e.direction === 'income'));
  const payable = entryTotals(pending.filter((e) => e.direction === 'expense'));
  return { receivable, payable, net: subtractTotals(receivable, payable), overdueReceivable: entryTotals(pending.filter((e) => e.direction === 'income' && isOverdue(e, today))) };
}

// ---------- Recurrence ----------

/** The occurrence after this one (same day of month, clamped). */
export function nextOccurrenceDays(e: Pick<FinanceEntry, 'date' | 'dueDate' | 'recurrence'>): { date: string; dueDate: string | null } | null {
  if (e.recurrence === 'none') return null;
  const months = e.recurrence === 'monthly' ? 1 : 12;
  return { date: addMonthsToDay(e.date, months), dueDate: e.dueDate ? addMonthsToDay(e.dueDate, months) : null };
}

/** The newest occurrence of every recurring series (cancelled series left out). */
export function latestOfSeries<T extends FinanceEntry>(entries: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const e of entries) {
    if (e.recurrence === 'none') continue;
    const cur = latest.get(e.seriesId);
    if (!cur || e.date > cur.date || (e.date === cur.date && e.createdAt > cur.createdAt)) latest.set(e.seriesId, e);
  }
  return [...latest.values()].filter((e) => e.status !== 'cancelled');
}

export const isLatestOfSeries = (e: FinanceEntry, entries: readonly FinanceEntry[]): boolean =>
  e.recurrence !== 'none' && !entries.some((x) => x.seriesId === e.seriesId && x.id !== e.id && (x.date > e.date || (x.date === e.date && x.createdAt > e.createdAt)));

/** Recurring commitments: what the active recurring items cost / bring per month and per year. */
export function recurringCommitments(entries: readonly FinanceEntry[], direction: FinanceDirection): { monthly: CurrencyTotals; yearly: CurrencyTotals } {
  const active = latestOfSeries(entries).filter((e) => e.direction === direction);
  return { monthly: entryTotals(active.filter((e) => e.recurrence === 'monthly')), yearly: entryTotals(active.filter((e) => e.recurrence === 'yearly')) };
}

// ---------- List filters ----------

export const FINANCE_TABS = ['all', 'income', 'expense', 'pending', 'paid', 'upcoming'] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];
export const KITE_TAB_LABELS: Record<FinanceTab, string> = { all: 'Tümü', income: 'Gelir', expense: 'Gider', pending: 'Bekleyen', paid: 'Ödenen', upcoming: 'Yaklaşan' };
export const PERSONAL_TAB_LABELS: Record<FinanceTab, string> = { ...KITE_TAB_LABELS, expense: 'Harcama' };

export interface FinanceFilters {
  tab: FinanceTab;
  /** "YYYY-MM"; ignored by the Bekleyen and Yaklaşan tabs (open items of every month). */
  month: string | null;
  currency: FinanceCurrency | null;
  category: string | null;
  status: FinanceStatus | null;
  kind: EntryKind | null;
}

export const monthIndependentTab = (tab: FinanceTab) => tab === 'pending' || tab === 'upcoming';

/** Filters and sorts: open-item tabs nearest due first, everything else newest first. */
export function filterEntries<T extends FinanceEntry>(entries: readonly T[], f: FinanceFilters, today: string): T[] {
  const rows = entries.filter((e) => {
    if (f.tab === 'income' && e.direction !== 'income') return false;
    if (f.tab === 'expense' && e.direction !== 'expense') return false;
    if (f.tab === 'pending' && e.status !== 'pending') return false;
    if (f.tab === 'paid' && e.status !== 'paid') return false;
    if (f.tab === 'upcoming' && !isUpcoming(e, today)) return false;
    if (f.month && !monthIndependentTab(f.tab) && monthOf(effectiveDay(e)) !== f.month) return false;
    if (f.currency && e.currency !== f.currency) return false;
    if (f.category && e.category !== f.category) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.kind && (e.status === 'cancelled' || kindOf(e) !== f.kind)) return false;
    return true;
  });
  const asc = monthIndependentTab(f.tab);
  return rows.sort((a, b) => {
    const d = effectiveDay(a).localeCompare(effectiveDay(b));
    return (asc ? d : -d) || b.createdAt.localeCompare(a.createdAt);
  });
}

// ---------- CSV ----------

const csvCell = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** Semicolon separated (opens in Turkish Excel), amounts with a decimal comma, one row per entry. */
export function entriesToCsv(rows: readonly (FinanceEntry & { linkName?: string })[], scope: 'kite' | 'personal'): string {
  const kinds = scope === 'kite' ? KITE_KIND_LABELS : PERSONAL_KIND_LABELS;
  const head = ['Tarih', 'Başlık', scope === 'kite' ? 'Şirket / Müşteri' : 'Kişi / Yer', 'Kategori', 'Tür', 'Tutar', 'Para birimi', 'Durum', 'Vade', 'Ödeme tarihi', 'Tekrar', 'Not'];
  const lines = rows.map((e) =>
    [e.date, e.title, e.linkName || e.counterparty, categoryLabel(scope, e.category), kinds[kindOf(e)], (e.amountMinor / 100).toFixed(2).replace('.', ','), e.currency, FINANCE_STATUS_LABELS[e.status], e.dueDate ?? '', e.paidOn ?? '', RECURRENCE_LABELS[e.recurrence], e.notes]
      .map((v) => csvCell(String(v)))
      .join(';'),
  );
  return [head.join(';'), ...lines].join('\r\n');
}

// ---------- Personal: debts and budgets ----------

export const debtPaid = (d: Pick<PersonalDebt, 'payments'>): number => d.payments.reduce((s, p) => s + p.amountMinor, 0);
export const debtRemaining = (d: Pick<PersonalDebt, 'payments' | 'principalMinor'>): number => d.principalMinor - debtPaid(d);
export const isDebtOpen = (d: Pick<PersonalDebt, 'payments' | 'principalMinor'>): boolean => debtRemaining(d) > 0;

export interface BudgetStatus {
  currency: FinanceCurrency;
  limitMinor: number;
  spentMinor: number;
  /** Negative when the budget is exceeded. */
  remainingMinor: number;
}

/** Spending = paid personal expenses of the month (debt repayments are shown separately). */
export function budgetStatus(entries: readonly PersonalFinanceEntry[], budgets: readonly PersonalBudget[], month: string): BudgetStatus[] {
  const spent = monthSummary(entries, month).expense;
  return FINANCE_CURRENCIES.flatMap((c) => {
    const b = budgets.find((x) => x.currency === c);
    if (!b) return [];
    const s = spent.find((t) => t.currency === c)?.amountMinor ?? 0;
    return [{ currency: c, limitMinor: b.monthlyLimitMinor, spentMinor: s, remainingMinor: b.monthlyLimitMinor - s }];
  });
}

export interface PersonalMonthView extends MonthSummary {
  debtRepayments: CurrencyTotals;
  debtRemaining: CurrencyTotals;
  recurring: { monthly: CurrencyTotals; yearly: CurrencyTotals };
  budgets: BudgetStatus[];
}

export function personalMonthView(data: PersonalFinanceData, month: string): PersonalMonthView {
  const payments = data.debts.flatMap((d) => d.payments.filter((p) => monthOf(p.paidOn) === month).map((p) => ({ currency: d.currency, amountMinor: p.amountMinor })));
  return {
    ...monthSummary(data.entries, month),
    debtRepayments: totalsByCurrency(payments, (p) => p.currency, (p) => p.amountMinor),
    debtRemaining: totalsByCurrency(data.debts.filter(isDebtOpen), (d) => d.currency, debtRemaining),
    recurring: recurringCommitments(data.entries, 'expense'),
    budgets: budgetStatus(data.entries, data.budgets, month),
  };
}

export interface UpcomingPayment {
  key: string;
  title: string;
  day: string;
  amountMinor: number;
  currency: FinanceCurrency;
  source: 'entry' | 'debt';
  overdue: boolean;
}

/** Pending personal payments and the next debt instalments due within 30 days (overdue first). */
export function upcomingPersonalPayments(data: PersonalFinanceData, today: string): UpcomingPayment[] {
  const limit = addDaysToDay(today, UPCOMING_FINANCE_DAYS);
  const fromEntries = data.entries
    .filter((e) => e.direction === 'expense' && isUpcoming(e, today))
    .map((e): UpcomingPayment => ({ key: e.id, title: e.title, day: effectiveDay(e), amountMinor: e.amountMinor, currency: e.currency, source: 'entry', overdue: effectiveDay(e) < today }));
  const fromDebts = data.debts
    .filter((d) => isDebtOpen(d) && d.nextDueDate && d.nextDueDate <= limit)
    .map((d): UpcomingPayment => ({
      key: d.id,
      title: `${d.creditor} · borç ödemesi`,
      day: d.nextDueDate!,
      amountMinor: Math.min(d.installmentMinor ?? debtRemaining(d), debtRemaining(d)),
      currency: d.currency,
      source: 'debt',
      overdue: d.nextDueDate! < today,
    }));
  return [...fromEntries, ...fromDebts].sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title, 'tr'));
}
