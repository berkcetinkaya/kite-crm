// Search, filter and sort for the prospect list. Pure functions over the current company array,
// so results are derived on render (never stored) and the whole module maps cleanly to a backend
// query (search + filters + sort parameters) later.
import type { Company, CompanySource } from '../../domain/company';
import { SALES_STATUS_ORDER, type SalesStatus } from '../../domain/salesStatus';
import { scoreBand, type ScoreBand } from '../../domain/score';
import type { ServiceKey } from '../../domain/services';
import { compareTr, foldForSearch } from '../../lib/text';

export const ALL = 'all' as const;
type OrAll<T> = T | typeof ALL;

export type ScoreFilter = ScoreBand | 'unscored';

export interface CompanyFilters {
  status: OrAll<SalesStatus>;
  service: OrAll<ServiceKey>;
  sector: OrAll<string>;
  city: OrAll<string>;
  score: OrAll<ScoreFilter>;
  source: OrAll<CompanySource>;
}

export const EMPTY_FILTERS: CompanyFilters = {
  status: ALL,
  service: ALL,
  sector: ALL,
  city: ALL,
  score: ALL,
  source: ALL,
};

export type CompanySort = 'score' | 'newest' | 'updated' | 'name';

export const SORT_OPTIONS: { id: CompanySort; label: string }[] = [
  { id: 'score', label: 'En Yüksek Fırsat Skoru' },
  { id: 'newest', label: 'En Yeni' },
  { id: 'updated', label: 'En Son Güncellenen' },
  { id: 'name', label: 'Şirket Adı' },
];

export interface CompanyQuery {
  search: string;
  filters: CompanyFilters;
  sort: CompanySort;
}

export function activeFilterCount(filters: CompanyFilters): number {
  return Object.values(filters).filter((v) => v !== ALL).length;
}

function matchesSearch(company: Company, foldedQuery: string): boolean {
  if (!foldedQuery) return true;
  const haystack = [
    company.name,
    company.website ?? '',
    company.sector,
    company.city,
    ...company.contacts.map((c) => c.fullName),
  ];
  return haystack.some((value) => foldForSearch(value).includes(foldedQuery));
}

function matchesFilters(company: Company, f: CompanyFilters): boolean {
  if (f.status !== ALL && company.status !== f.status) return false;
  if (f.service !== ALL && !company.opportunities.some((o) => o.service === f.service)) return false;
  if (f.sector !== ALL && company.sector !== f.sector) return false;
  if (f.city !== ALL && company.city !== f.city) return false;
  if (f.source !== ALL && company.source !== f.source) return false;
  if (f.score !== ALL) {
    if (f.score === 'unscored') return company.opportunityScore === null;
    if (company.opportunityScore === null || scoreBand(company.opportunityScore) !== f.score) return false;
  }
  return true;
}

const comparators: Record<CompanySort, (a: Company, b: Company) => number> = {
  // Unscored companies go last.
  score: (a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1) || compareTr(a.name, b.name),
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  name: (a, b) => compareTr(a.name, b.name),
};

export function queryCompanies(companies: readonly Company[], query: CompanyQuery): Company[] {
  const folded = foldForSearch(query.search.trim());
  return companies
    .filter((c) => matchesSearch(c, folded) && matchesFilters(c, query.filters))
    .sort(comparators[query.sort]);
}

export function countByStatus(companies: readonly Company[]): Record<SalesStatus, number> {
  const counts = Object.fromEntries(SALES_STATUS_ORDER.map((s) => [s, 0])) as Record<SalesStatus, number>;
  for (const c of companies) counts[c.status] += 1;
  return counts;
}

/** Distinct values present in the data, for filter dropdowns and form suggestions. */
export function distinctValues(companies: readonly Company[], key: 'sector' | 'city'): string[] {
  return [...new Set(companies.map((c) => c[key]).filter(Boolean))].sort(compareTr);
}
