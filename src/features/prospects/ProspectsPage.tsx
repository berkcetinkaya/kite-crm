import { useMemo, useState } from 'react';
import { Building2, Plus, SearchX } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import type { SalesStatus } from '../../domain/salesStatus';
import { ProspectSummary } from './components/ProspectSummary';
import { ProspectToolbar } from './components/ProspectToolbar';
import { ProspectTable } from './components/ProspectTable';
import { AddCompanyDrawer } from './components/AddCompanyDrawer';
import { CompanyDrawer } from './detail/CompanyDrawer';
import {
  ALL,
  EMPTY_FILTERS,
  activeFilterCount,
  countByStatus,
  distinctValues,
  queryCompanies,
  type CompanyFilters,
  type CompanySort,
} from './query';

export function ProspectsPage() {
  const { companies } = useCompanies();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CompanyFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<CompanySort>('score');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Everything below is derived from the company list on each render; nothing is cached in state.
  const visible = useMemo(() => queryCompanies(companies, { search, filters, sort }), [companies, search, filters, sort]);
  const counts = useMemo(() => countByStatus(companies), [companies]);
  const sectors = useMemo(() => distinctValues(companies, 'sector'), [companies]);
  const cities = useMemo(() => distinctValues(companies, 'city'), [companies]);

  const narrowed = search.trim() !== '' || activeFilterCount(filters) > 0;
  const clearAll = () => {
    setSearch('');
    setFilters(EMPTY_FILTERS);
  };

  return (
    <div className="page prospects">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Potansiyel Müşteriler</h1>
          <p className="page-header__subtitle">KITE için araştırılan ve satış sürecine alınan şirketleri yönet.</p>
        </div>
        <button type="button" className="button button--primary" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" />
          Şirket Ekle
        </button>
      </header>

      <ProspectSummary
        total={companies.length}
        counts={counts}
        activeStatus={filters.status === ALL ? null : filters.status}
        onSelectStatus={(status: SalesStatus | null) => setFilters((f) => ({ ...f, status: status ?? ALL }))}
      />

      <section className="card prospects__list" aria-label="Şirket listesi">
        <ProspectToolbar
          search={search}
          onSearchChange={setSearch}
          filters={filters}
          onFiltersChange={setFilters}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
          sort={sort}
          onSortChange={setSort}
          sectors={sectors}
          cities={cities}
        />

        <p className="prospects__result-count" role="status">
          {narrowed
            ? `${companies.length} şirketten ${visible.length} tanesi gösteriliyor`
            : `${companies.length} şirket`}
        </p>

        {companies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Henüz şirket yok"
            description="İlk potansiyel müşteriyi ekleyerek başla."
            action={
              <button type="button" className="button button--primary" onClick={() => setAdding(true)}>
                <Plus size={16} aria-hidden="true" />
                Şirket Ekle
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Sonuç bulunamadı"
            description="Aramanı veya filtreleri değiştirmeyi dene."
            action={
              <button type="button" className="button button--secondary" onClick={clearAll}>
                Aramayı ve filtreleri temizle
              </button>
            }
          />
        ) : (
          <div className="prospects__table-wrap">
            <ProspectTable companies={visible} selectedId={openId} onOpen={setOpenId} />
          </div>
        )}
      </section>

      <CompanyDrawer companyId={openId} onClose={() => setOpenId(null)} />
      <AddCompanyDrawer
        open={adding}
        onClose={() => setAdding(false)}
        sectors={sectors}
        cities={cities}
      />
    </div>
  );
}
