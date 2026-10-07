// Hedef step (Phase 12): explicit discovery filters and the pre-run summary of what a run may use.
// Nothing is inferred silently; paid research only starts with "Araştırmayı Başlat".
import { useId } from 'react';
import { COMPANY_SIZE_ORDER, COMPANY_SIZES } from '../../../domain/company';
import {
  LANGUAGE_FILTER_LABELS,
  LANGUAGE_FILTERS,
  WEBSITE_FILTER_LABELS,
  WEBSITE_FILTERS,
  type DiscoveryFilters,
  type LanguageFilter,
  type SizeFilter,
  type WebsiteFilter,
} from '../../../domain/prospecting';
import { plannedSearches } from '../../../domain/researchApi';
import { SECTOR_FAMILIES, SECTOR_FAMILY_IDS, type SectorFamilyId } from '../../../domain/sectorTaxonomy';
import type { ResearchProviderId } from '../../../domain/research';

export function DiscoveryFilterFields({ filters, onChange }: { filters: DiscoveryFilters; onChange: (f: DiscoveryFilters) => void }) {
  const id = useId();
  const set = <K extends keyof DiscoveryFilters>(k: K, v: DiscoveryFilters[K]) => onChange({ ...filters, [k]: v });
  return (
    <fieldset className="discovery-filters form-grid__full">
      <legend className="field__label">Hedefleme filtreleri</legend>
      <div className="discovery-filters__grid">
        <label className="field" htmlFor={`${id}-family`}>
          <span className="field__label">Sektör ailesi</span>
          <select id={`${id}-family`} className="input" value={filters.familyId ?? ''} onChange={(e) => set('familyId', (e.target.value || null) as SectorFamilyId | null)}>
            <option value="">Sektörden belirlensin</option>
            {SECTOR_FAMILY_IDS.map((f) => (
              <option key={f} value={f}>
                {SECTOR_FAMILIES[f].labelTr}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={`${id}-website`}>
          <span className="field__label">Website</span>
          <select id={`${id}-website`} className="input" value={filters.website} onChange={(e) => set('website', e.target.value as WebsiteFilter)}>
            {WEBSITE_FILTERS.map((w) => (
              <option key={w} value={w}>
                {WEBSITE_FILTER_LABELS[w]}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={`${id}-language`}>
          <span className="field__label">Dil</span>
          <select id={`${id}-language`} className="input" value={filters.language} onChange={(e) => set('language', e.target.value as LanguageFilter)}>
            {LANGUAGE_FILTERS.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_FILTER_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={`${id}-size`}>
          <span className="field__label">Şirket büyüklüğü</span>
          <select id={`${id}-size`} className="input" value={filters.size} onChange={(e) => set('size', e.target.value as SizeFilter)}>
            <option value="any">Fark etmez</option>
            {COMPANY_SIZE_ORDER.map((s) => (
              <option key={s} value={s}>
                {COMPANY_SIZES[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="stage-move__check">
        <input type="checkbox" checked={filters.contactRequired} onChange={(e) => set('contactRequired', e.target.checked)} />
        <span>Herkese açık iletişim kanalı olsun (e-posta, telefon, WhatsApp veya iletişim formu)</span>
      </label>
      {filters.website !== 'has' && (
        <p className="sales-hint sales-hint--warn">Websitesi olmayan şirketlerin sitesi incelenemez; araştırma güveni düşük kalır ve website sinyalleri “Bilinmiyor” görünür.</p>
      )}
    </fieldset>
  );
}

interface RunSummaryProps {
  provider: ResearchProviderId;
  companyCount: number;
  maxSearchesPerDiscovery: number | null;
  maxExtraPages: number | null;
  realRuns: { today: number; limit: number } | null;
}

/** What the run may use, shown before anything starts. */
export function RunSummary({ provider, companyCount, maxSearchesPerDiscovery, maxExtraPages, realRuns }: RunSummaryProps) {
  const fixture = provider === 'fixture';
  const count = Number.isFinite(companyCount) && companyCount > 0 ? companyCount : 0;
  const searches = maxSearchesPerDiscovery ? plannedSearches(count || 1, maxSearchesPerDiscovery) : null;
  const pages = maxExtraPages !== null ? 1 + maxExtraPages : null;
  const left = realRuns ? Math.max(0, realRuns.limit - realRuns.today) : null;
  return (
    <div className={fixture ? 'run-summary run-summary--test' : 'run-summary'} aria-label="Bu araştırma ne kullanacak">
      <p className="run-summary__title">{fixture ? 'Test sağlayıcısı (fixture): ücretsiz, çevrimdışı' : 'Gerçek sağlayıcı (Anthropic): ücretli API'}</p>
      <ul className="run-summary__list">
        <li>En fazla {count || '—'} şirket</li>
        <li>En fazla {searches ?? '—'} web araması</li>
        <li>
          En fazla {count || '—'} şirket websitesi incelemesi{pages ? ` (şirket başına en fazla ${pages} sayfa)` : ''}
        </li>
        <li>Analiz 3'erli gruplar halinde yapılır; sayfa açılınca hiçbir şey kendiliğinden başlamaz.</li>
        {fixture ? (
          <li>Test çalışmaları günlük gerçek araştırma sınırına sayılmaz.</li>
        ) : (
          realRuns && <li className={left === 0 ? 'run-summary__limit' : undefined}>Bugün kalan gerçek araştırma hakkı: {left} / {realRuns.limit}</li>
        )}
      </ul>
    </div>
  );
}
