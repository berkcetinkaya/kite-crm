import { describe, expect, it } from 'vitest';
import {
  addMonthsToDay,
  budgetStatus,
  containsFinanceSecret,
  entriesToCsv,
  filterEntries,
  formatAmount,
  isDayKey,
  kindOf,
  kindParts,
  latestOfSeries,
  monthSummary,
  nextOccurrenceDays,
  openPosition,
  personalMonthView,
  recurringCommitments,
  subtractTotals,
  todayKey,
  upcomingPersonalPayments,
  type FinanceEntry,
  type FinanceFilters,
  type PersonalDebt,
} from './finance';

let n = 0;
const entry = (over: Partial<FinanceEntry> = {}): FinanceEntry => {
  const id = `pfe_${++n}`;
  const status = over.status ?? 'paid';
  return {
    id,
    direction: 'expense',
    title: 'Kayıt',
    notes: '',
    counterparty: '',
    amountMinor: 100_00,
    currency: 'TRY',
    category: 'other',
    date: '2026-10-05',
    dueDate: null,
    recurrence: 'none',
    seriesId: id,
    paidOn: status === 'paid' ? (over.date ?? '2026-10-05') : null,
    paidAt: status === 'paid' ? '2026-10-05T09:00:00.000Z' : null,
    cancelledAt: status === 'cancelled' ? '2026-10-05T09:00:00.000Z' : null,
    createdAt: `2026-10-05T09:00:${String(n % 60).padStart(2, '0')}.000Z`,
    updatedAt: '2026-10-05T09:00:00.000Z',
    ...over,
    status,
  };
};
const filters = (over: Partial<FinanceFilters> = {}): FinanceFilters => ({ tab: 'all', month: null, currency: null, category: null, status: null, kind: null, ...over });

describe('finance domain', () => {
  it('formats amounts with the currency code and never converts', () => {
    expect(formatAmount(4_200_000, 'TRY')).toBe('TRY 42.000');
    expect(formatAmount(85_050, 'USD')).toBe('USD 850,50');
    expect(formatAmount(650_000_000, 'IDR')).toBe('IDR 6.500.000');
  });

  it('keeps every total per currency (no FX, no combined total)', () => {
    const rows = [entry({ amountMinor: 1_000, currency: 'TRY' }), entry({ amountMinor: 1_000, currency: 'USD' }), entry({ amountMinor: 500, currency: 'TRY' }), entry({ amountMinor: 7, currency: 'IDR' })];
    expect(monthSummary(rows, '2026-10').expense).toEqual([
      { currency: 'TRY', amountMinor: 1_500 },
      { currency: 'USD', amountMinor: 1_000 },
      { currency: 'IDR', amountMinor: 7 },
    ]);
    expect(subtractTotals([{ currency: 'USD', amountMinor: 500 }], [{ currency: 'TRY', amountMinor: 200 }])).toEqual([
      { currency: 'TRY', amountMinor: -200 },
      { currency: 'USD', amountMinor: 500 },
    ]);
  });

  it('maps form kinds to direction + status and back', () => {
    expect(kindParts('receivable')).toEqual({ direction: 'income', status: 'pending' });
    expect(kindParts('expense')).toEqual({ direction: 'expense', status: 'paid' });
    expect(kindOf({ direction: 'income', status: 'paid' })).toBe('income');
    expect(kindOf({ direction: 'expense', status: 'cancelled' })).toBe('payable');
  });

  it('month summary: paid by payment day, pending by due day, cancelled ignored', () => {
    const rows = [
      entry({ direction: 'income', date: '2026-09-20', dueDate: '2026-09-30', paidOn: '2026-10-02' }),
      entry({ direction: 'income', status: 'pending', date: '2026-09-01', dueDate: '2026-10-15' }),
      entry({ direction: 'expense', status: 'pending', date: '2026-10-01', dueDate: '2026-11-01' }),
      entry({ direction: 'expense', status: 'cancelled', date: '2026-10-03' }),
    ];
    const s = monthSummary(rows, '2026-10');
    expect(s.income).toEqual([{ currency: 'TRY', amountMinor: 100_00 }]);
    expect(s.receivable).toEqual([{ currency: 'TRY', amountMinor: 100_00 }]);
    expect(s.payable).toEqual([]);
    expect(s.expense).toEqual([]);
    expect(openPosition(rows, '2026-10-20')).toEqual({
      receivable: [{ currency: 'TRY', amountMinor: 100_00 }],
      payable: [{ currency: 'TRY', amountMinor: 100_00 }],
      net: [],
      overdueReceivable: [{ currency: 'TRY', amountMinor: 100_00 }],
    });
  });

  it('filters by tab, month, currency, category, status and kind; open tabs sort nearest first', () => {
    const a = entry({ direction: 'income', status: 'pending', dueDate: '2026-11-20', currency: 'USD', category: 'client_payment' });
    const b = entry({ direction: 'expense', status: 'pending', dueDate: '2026-10-12', category: 'software' });
    const c = entry({ direction: 'income', date: '2026-10-08', category: 'client_payment' });
    const d = entry({ direction: 'expense', date: '2026-09-28', category: 'software' });
    const all = [a, b, c, d];
    const today = '2026-10-09';
    expect(filterEntries(all, filters({ month: '2026-10' }), today).map((e) => e.id)).toEqual([b.id, c.id]);
    expect(filterEntries(all, filters({ tab: 'pending', month: '2026-10' }), today).map((e) => e.id)).toEqual([b.id, a.id]);
    expect(filterEntries(all, filters({ tab: 'upcoming' }), today).map((e) => e.id)).toEqual([b.id]);
    expect(filterEntries(all, filters({ tab: 'income' }), today).map((e) => e.id)).toEqual([a.id, c.id]);
    expect(filterEntries(all, filters({ tab: 'paid' }), today).map((e) => e.id)).toEqual([c.id, d.id]);
    expect(filterEntries(all, filters({ currency: 'USD' }), today)).toEqual([a]);
    expect(filterEntries(all, filters({ category: 'software', status: 'paid' }), today)).toEqual([d]);
    expect(filterEntries(all, filters({ kind: 'receivable' }), today)).toEqual([a]);
  });

  it('dates: calendar days, clamped month steps, Istanbul today', () => {
    expect(isDayKey('2026-02-29')).toBe(false);
    expect(isDayKey('2028-02-29')).toBe(true);
    expect(addMonthsToDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDay('2026-12-15', 1)).toBe('2027-01-15');
    expect(nextOccurrenceDays({ date: '2026-10-15', dueDate: '2026-10-20', recurrence: 'yearly' })).toEqual({ date: '2027-10-15', dueDate: '2027-10-20' });
    expect(nextOccurrenceDays({ date: '2026-10-15', dueDate: null, recurrence: 'none' })).toBeNull();
    // 22:30 UTC on the 9th is already the 10th in Istanbul.
    expect(todayKey('2026-10-09T22:30:00.000Z')).toBe('2026-10-10');
  });

  it('recurring commitments use the latest occurrence of each series', () => {
    const first = entry({ recurrence: 'monthly', amountMinor: 2_500_000, title: 'Kira' });
    const second = { ...entry({ recurrence: 'monthly', amountMinor: 2_600_000, status: 'pending', date: '2026-11-05' }), seriesId: first.seriesId };
    const yearly = entry({ recurrence: 'yearly', amountMinor: 900_000 });
    const stopped = entry({ recurrence: 'monthly', status: 'cancelled', currency: 'USD' });
    const rows = [first, second, yearly, stopped];
    expect(latestOfSeries(rows).map((e) => e.id).sort()).toEqual([second.id, yearly.id].sort());
    expect(recurringCommitments(rows, 'expense')).toEqual({ monthly: [{ currency: 'TRY', amountMinor: 2_600_000 }], yearly: [{ currency: 'TRY', amountMinor: 900_000 }] });
  });

  it('budget, debt totals, repayments and upcoming payments for the personal view', () => {
    const debt: PersonalDebt = {
      id: 'dbt_1',
      creditor: 'Yasemin',
      notes: '',
      currency: 'TRY',
      principalMinor: 12_000_000,
      startDate: '2026-09-01',
      nextDueDate: '2026-11-05',
      installmentMinor: 2_000_000,
      createdAt: '',
      updatedAt: '',
      closedAt: null,
      payments: [
        { id: 'p1', debtId: 'dbt_1', amountMinor: 2_000_000, paidOn: '2026-09-15', notes: '', createdAt: '' },
        { id: 'p2', debtId: 'dbt_1', amountMinor: 2_000_000, paidOn: '2026-10-15', notes: '', createdAt: '' },
      ],
    };
    const entries = [
      entry({ amountMinor: 2_650_000 }),
      entry({ amountMinor: 50_00, currency: 'USD' }),
      entry({ direction: 'income', amountMinor: 6_000_000 }),
      entry({ status: 'pending', title: 'Motor taksidi', dueDate: '2026-10-25', amountMinor: 450_000 }),
    ];
    const budgets = [{ currency: 'TRY' as const, monthlyLimitMinor: 4_000_000, updatedAt: '' }];
    expect(budgetStatus(entries, budgets, '2026-10')).toEqual([{ currency: 'TRY', limitMinor: 4_000_000, spentMinor: 2_650_000, remainingMinor: 1_350_000 }]);
    const view = personalMonthView({ entries, debts: [debt], budgets }, '2026-10');
    expect(view.debtRepayments).toEqual([{ currency: 'TRY', amountMinor: 2_000_000 }]);
    expect(view.debtRemaining).toEqual([{ currency: 'TRY', amountMinor: 8_000_000 }]);
    expect(view.expense).toEqual([
      { currency: 'TRY', amountMinor: 2_650_000 },
      { currency: 'USD', amountMinor: 50_00 },
    ]);
    expect(upcomingPersonalPayments({ entries, debts: [debt], budgets }, '2026-10-09').map((u) => [u.title, u.day, u.amountMinor])).toEqual([
      ['Motor taksidi', '2026-10-25', 450_000],
      ['Yasemin · borç ödemesi', '2026-11-05', 2_000_000],
    ]);
  });

  it('refuses credential-like text, card numbers, PINs and seed phrases but allows normal notes', () => {
    for (const bad of ['şifre: abc123', 'api key = sk-live', '4111 1111 1111 1111', '5500-0000-0000-0004', 'PIN 4321', 'cvv: 123', 'Seed phrase: abandon …', 'kurtarma kelimeleri', 'Bearer abcdefghijklmnop'])
      expect(containsFinanceSecret(bad), bad).toBe(true);
    for (const ok of ['Fatura 2026-104', 'IBAN sonra eklenecek', 'Telefon 0532 111 22 33', '12 taksit, 15 Kasım', 'Pinterest reklamı', 'Ödeme 1.250.000 IDR'])
      expect(containsFinanceSecret(ok), ok).toBe(false);
  });

  it('exports the filtered rows as semicolon CSV', () => {
    const csv = entriesToCsv([{ ...entry({ direction: 'income', title: 'Ecru; aylık', amountMinor: 50_000, currency: 'USD', category: 'client_payment' }), linkName: 'Ecru Atelier' }], 'kite');
    const [head, row] = csv.split('\r\n');
    expect(head.startsWith('Tarih;Başlık;Şirket / Müşteri;Kategori;Tür;Tutar;Para birimi;Durum')).toBe(true);
    expect(row).toBe('2026-10-05;"Ecru; aylık";Ecru Atelier;Müşteri Ödemesi;Gelir;500,00;USD;Ödendi;;2026-10-05;Tekrarlanmaz;');
  });
});
