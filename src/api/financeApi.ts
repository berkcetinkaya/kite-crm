// Browser client for KITE Finans and Berk (schema v9). The two sides use separate endpoints; every
// mutation returns that side's complete, fresh data.
import type {
  DebtPaymentInput,
  FinanceCurrency,
  FinanceEntryInput,
  FinanceStatus,
  KiteFinanceData,
  KiteFinanceEntryInput,
  PersonalDebtInput,
  PersonalFinanceData,
} from '../domain/finance';
import { request } from './dataApi';

const k = '/api/finance/kite';
const p = '/api/finance/personal';

export const kiteFinanceApi = {
  load: (signal?: AbortSignal) => request<KiteFinanceData>('GET', k, undefined, signal),
  create: (entry: KiteFinanceEntryInput) => request<KiteFinanceData>('POST', `${k}/entries`, { entry }),
  update: (id: string, entry: KiteFinanceEntryInput) => request<KiteFinanceData>('PUT', `${k}/entries/${id}`, { entry }),
  status: (id: string, to: FinanceStatus, paidOn: string | null = null) => request<KiteFinanceData>('POST', `${k}/entries/${id}/status`, { to, paidOn }),
  next: (id: string) => request<KiteFinanceData>('POST', `${k}/entries/${id}/next`, {}),
  remove: (id: string) => request<KiteFinanceData>('POST', `${k}/entries/${id}/delete`, {}),
};

export const personalFinanceApi = {
  load: (signal?: AbortSignal) => request<PersonalFinanceData>('GET', p, undefined, signal),
  create: (entry: FinanceEntryInput) => request<PersonalFinanceData>('POST', `${p}/entries`, { entry }),
  update: (id: string, entry: FinanceEntryInput) => request<PersonalFinanceData>('PUT', `${p}/entries/${id}`, { entry }),
  status: (id: string, to: FinanceStatus, paidOn: string | null = null) => request<PersonalFinanceData>('POST', `${p}/entries/${id}/status`, { to, paidOn }),
  next: (id: string) => request<PersonalFinanceData>('POST', `${p}/entries/${id}/next`, {}),
  remove: (id: string) => request<PersonalFinanceData>('POST', `${p}/entries/${id}/delete`, {}),
  createDebt: (debt: PersonalDebtInput) => request<PersonalFinanceData>('POST', `${p}/debts`, { debt }),
  updateDebt: (id: string, debt: PersonalDebtInput) => request<PersonalFinanceData>('PUT', `${p}/debts/${id}`, { debt }),
  removeDebt: (id: string) => request<PersonalFinanceData>('POST', `${p}/debts/${id}/delete`, {}),
  addPayment: (debtId: string, payment: DebtPaymentInput) => request<PersonalFinanceData>('POST', `${p}/debts/${debtId}/payments`, { payment }),
  removePayment: (debtId: string, paymentId: string) => request<PersonalFinanceData>('POST', `${p}/debts/${debtId}/payments/${paymentId}/delete`, {}),
  setBudget: (currency: FinanceCurrency, monthlyLimitMinor: number | null) => request<PersonalFinanceData>('PUT', `${p}/budgets/${currency}`, { monthlyLimitMinor }),
};
