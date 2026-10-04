import { useEffect, useRef } from 'react';
import { ArrowRight, Info, SearchX, UserPlus } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { useToast } from '../../../components/ui/Toast';
import { OpportunityScore } from '../../../components/sales/OpportunityScore';
import type { Company } from '../../../domain/company';
import { formatLocation } from '../../../domain/locations';
import { findProspectMatch, type ResearchRequest, type ResearchResult } from '../../../domain/research';
import { SERVICES } from '../../../domain/services';
import { formatDateTime } from '../../../lib/date';
import { useResearch } from '../../../state/research/ResearchProvider';

type RowStatus = 'new' | 'selected' | 'listed' | 'added';

const ROW_STATUS: Record<RowStatus, { label: string; tone: BadgeTone }> = {
  new: { label: 'Yeni', tone: 'info' },
  selected: { label: 'Seçildi', tone: 'accent' },
  listed: { label: 'Zaten Listede', tone: 'neutral' },
  added: { label: 'Eklendi', tone: 'success' },
};

/** Live status: a company added to prospects after the job ran still shows as "Zaten Listede". */
function rowStatus(r: ResearchResult, companies: readonly Company[]): RowStatus {
  if (r.transferredCompanyId) return 'added';
  if (r.alreadyInProspects || findProspectMatch({ name: r.companyName, website: r.website }, companies)) return 'listed';
  return r.selected ? 'selected' : 'new';
}

interface ResearchResultsProps {
  request: ResearchRequest;
  results: ResearchResult[];
  companies: readonly Company[];
  /** Focus the heading when a job is opened, so keyboard and screen-reader users land on it. */
  focusKey: number;
}

export function ResearchResults({ request, results, companies, focusKey }: ResearchResultsProps) {
  const { toggleResult, setSelection, transferSelected } = useResearch();
  const showToast = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusKey === 0) return;
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusKey]);

  const rows = results.map((r) => ({ result: r, status: rowStatus(r, companies) }));
  const selectable = rows.filter((x) => x.status === 'new' || x.status === 'selected');
  const selectedCount = rows.filter((x) => x.status === 'selected').length;
  const addedCount = rows.filter((x) => x.status === 'added').length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;

  const selectAll = () => setSelection(request.id, selectable.map((x) => x.result.id));
  const clearSelection = () => setSelection(request.id, []);

  const transfer = () => {
    const { added, duplicates } = transferSelected(request.id);
    showToast({
      title: added > 0 ? `${added} şirket Potansiyel Müşteriler'e eklendi` : 'Yeni şirket eklenmedi',
      description: [
        added > 0 ? 'Durum: Bulundu · Kaynak: Araştırma' : null,
        duplicates > 0 ? `${duplicates} şirket zaten listede olduğu için atlandı.` : null,
      ]
        .filter(Boolean)
        .join(' '),
    });
  };

  const requested = request.companyCount;

  return (
    <section className="card research-results" aria-labelledby="research-results-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="research-results-title" className="card__title" ref={headingRef} tabIndex={-1}>
            {request.name}
          </h2>
          <p className="card__subtitle">
            {formatLocation(request.city, request.country)}
            {!request.city && ' (ülke geneli)'} · {formatDateTime(new Date(request.createdAt))}
          </p>
        </div>
        <Badge tone="accent">Demo araştırma sonucu</Badge>
      </header>

      <div className="card__body research-results__body">
        <p className="demo-notice">
          <Info size={16} aria-hidden="true" />
          <span>
            Bu sonuçlar kurgusal demo verisidir. Gerçek araştırma motoru henüz devrede değil; hiçbir şirket internette
            araştırılmadı.
            {results.length < requested && ` İstenen ${requested} şirket yerine ${results.length} temsili sonuç gösteriliyor.`}
          </span>
        </p>

        {results.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Sonuç yok"
            description="Hariç tutma kriterleri tüm demo sonuçları eledi. Kriterleri değiştirip yeniden başlat."
          />
        ) : (
          <>
            <div className="selection-bar">
              <label className="checkbox selection-bar__all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                  }}
                  disabled={selectable.length === 0}
                  onChange={() => (allSelected ? clearSelection() : selectAll())}
                />
                Tümünü seç
              </label>
              <p className="selection-bar__count" role="status">
                {selectedCount > 0
                  ? `${selectedCount} şirket seçildi`
                  : selectable.length > 0
                    ? 'Henüz şirket seçilmedi'
                    : 'Seçilebilecek yeni şirket kalmadı'}
              </p>
              <div className="selection-bar__actions">
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={clearSelection}
                  disabled={selectedCount === 0}
                >
                  Seçimi Temizle
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={transfer}
                  disabled={selectedCount === 0}
                >
                  <UserPlus size={16} aria-hidden="true" />
                  Seçilenleri Potansiyel Müşterilere Ekle
                </button>
              </div>
            </div>

            {addedCount > 0 && (
              <p className="research-results__added">
                Bu araştırmadan {addedCount} şirket eklendi.{' '}
                <a className="link" href="#/prospects">
                  Potansiyel Müşteriler'de gör <ArrowRight size={14} aria-hidden="true" />
                </a>
              </p>
            )}

            <table className="result-table">
              <thead>
                <tr>
                  <th scope="col" className="col-check">
                    <span className="visually-hidden">Seç</span>
                  </th>
                  <th scope="col">Şirket</th>
                  <th scope="col" className="col-sector">
                    Sektör
                  </th>
                  <th scope="col">Konum</th>
                  <th scope="col" className="col-service">
                    Önerilen Hizmet
                  </th>
                  <th scope="col">Fırsat Skoru</th>
                  <th scope="col">Kısa Gerekçe</th>
                  <th scope="col">Durum</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ result: r, status }) => {
                  const locked = status === 'listed' || status === 'added';
                  return (
                    <tr key={r.id} className={status === 'selected' ? 'result-row result-row--selected' : 'result-row'}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={status === 'selected'}
                          disabled={locked}
                          onChange={() => toggleResult(request.id, r.id)}
                          aria-label={`${r.companyName} seç`}
                        />
                      </td>
                      <td className="cell-name">
                        <span className="result-row__name">{r.companyName}</span>
                        {/* Plain text: demo domains are fictional and must not link to real sites. */}
                        {r.website && <span className="result-row__site">{r.website}</span>}
                      </td>
                      <td className="col-sector">{r.sector}</td>
                      <td className="cell-location">{formatLocation(r.city, r.country)}</td>
                      <td className="col-service">
                        <span className="service-tag">{SERVICES[r.service].label}</span>
                      </td>
                      <td className="cell-score">
                        <OpportunityScore score={r.opportunityScore} />
                      </td>
                      <td className="cell-reason">{r.reason}</td>
                      <td className="cell-status">
                        <Badge tone={ROW_STATUS[status].tone} dot>
                          {ROW_STATUS[status].label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}
