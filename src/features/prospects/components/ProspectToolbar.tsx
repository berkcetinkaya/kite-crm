import { useState, type ChangeEvent } from 'react';
import { SalesStatusOptions } from '../../../components/sales/SalesStatusOptions';
import { FilterX, Search, SlidersHorizontal } from 'lucide-react';
import { COMPANY_SOURCES, COMPANY_SOURCE_ORDER } from '../../../domain/company';
import { SCORE_BANDS, SCORE_BAND_ORDER } from '../../../domain/score';
import { SERVICE_KEYS, SERVICES } from '../../../domain/services';
import { ALL, SORT_OPTIONS, activeFilterCount, type CompanyFilters, type CompanySort } from '../query';

interface ProspectToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: CompanyFilters;
  onFiltersChange: (filters: CompanyFilters) => void;
  onClearFilters: () => void;
  sort: CompanySort;
  onSortChange: (sort: CompanySort) => void;
  sectors: string[];
  cities: string[];
}

export function ProspectToolbar(props: ProspectToolbarProps) {
  const { search, onSearchChange, filters, onFiltersChange, onClearFilters, sort, onSortChange, sectors, cities } =
    props;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = activeFilterCount(filters);

  // Filter values come from <select> elements whose options are built from the typed lists below.
  const set = (key: keyof CompanyFilters) => (e: ChangeEvent<HTMLSelectElement>) =>
    onFiltersChange({ ...filters, [key]: e.target.value } as CompanyFilters);

  return (
    <div className="prospect-toolbar">
      <div className="prospect-toolbar__row">
        <label className="search-input">
          <Search size={16} aria-hidden="true" />
          <span className="visually-hidden">Ara</span>
          <input
            type="search"
            className="input"
            placeholder="Şirket, sektör, şehir veya kişi ara..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="button button--secondary prospect-toolbar__filter-toggle"
          aria-expanded={filtersOpen}
          aria-controls="prospect-filters"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          Filtreler{activeCount > 0 && ` (${activeCount})`}
        </button>
        <label className="sort-select">
          <span className="sort-select__label">Sırala</span>
          <select className="input" value={sort} onChange={(e) => onSortChange(e.target.value as CompanySort)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        id="prospect-filters"
        className={filtersOpen ? 'prospect-filters prospect-filters--open' : 'prospect-filters'}
        role="group"
        aria-label="Filtreler"
      >
        <label className="field">
          <span className="field__label">Durum</span>
          <select className="input" value={filters.status} onChange={set('status')}>
            <option value={ALL}>Tümü</option>
            <SalesStatusOptions />
          </select>
        </label>
        <label className="field">
          <span className="field__label">Hizmet Fırsatı</span>
          <select className="input" value={filters.service} onChange={set('service')}>
            <option value={ALL}>Tümü</option>
            {SERVICE_KEYS.map((s) => (
              <option key={s} value={s}>
                {SERVICES[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Sektör</span>
          <select className="input" value={filters.sector} onChange={set('sector')}>
            <option value={ALL}>Tümü</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Şehir</span>
          <select className="input" value={filters.city} onChange={set('city')}>
            <option value={ALL}>Tümü</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Fırsat Skoru</span>
          <select className="input" value={filters.score} onChange={set('score')}>
            <option value={ALL}>Tümü</option>
            {SCORE_BAND_ORDER.map((b) => (
              <option key={b} value={b}>
                {SCORE_BANDS[b].label}
              </option>
            ))}
            <option value="unscored">Puanlanmamış</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Kaynak</span>
          <select className="input" value={filters.source} onChange={set('source')}>
            <option value={ALL}>Tümü</option>
            {COMPANY_SOURCE_ORDER.map((s) => (
              <option key={s} value={s}>
                {COMPANY_SOURCES[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button button--ghost prospect-filters__clear"
          onClick={onClearFilters}
          disabled={activeCount === 0}
        >
          <FilterX size={16} aria-hidden="true" />
          Filtreleri Temizle
        </button>
      </div>
    </div>
  );
}
