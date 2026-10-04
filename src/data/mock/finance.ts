import type { KiteFinanceSummary, PersonalFinanceSummary } from '../../lib/types';

// Preview figures only. Net and "Kalan" are derived in the UI; no real finance logic yet.
export const mockKiteFinance: KiteFinanceSummary = {
  totalIncome: 186_000,
  collected: 124_500,
  toCollect: 61_500,
  expenses: 47_800,
};

export const mockPersonalFinance: PersonalFinanceSummary = {
  totalIncome: 85_000,
  totalExpense: 52_300,
  savingsGoal: 25_000,
};
