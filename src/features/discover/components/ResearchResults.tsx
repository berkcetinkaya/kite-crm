import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Circle, Info, Loader2, RotateCcw, SearchX, Square, UserPlus } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { useToast } from '../../../components/ui/Toast';
import { OpportunityScore } from '../../../components/sales/OpportunityScore';
import type { Company } from '../../../domain/company';
import { formatLocation } from '../../../domain/locations';
import {
  CONFIDENCE_LABELS,
  REAL_RESEARCH_STAGES,
  REAL_RESEARCH_STAGE_LABELS,
  VERIFICATION_STATUS_LABELS,
  type RealResearchProgress,
  type ResearchRequest,
  type ResearchResult,
  type VerificationStatus,
} from '../../../domain/research';
import { SERVICES } from '../../../domain/services';
import { formatDateTime } from '../../../lib/date';
import { toExternalUrl } from '../../../lib/url';
import { useResearch } from '../../../state/research/ResearchProvider';
import { ROW_STATUS, isSelectableStatus, orderRows, realSummary, rowStatus, type RowStatus } from '../resultView';
import { ResultDetailDrawer } from './ResultDetailDrawer';

const VERIFICATION_TONE: Record<VerificationStatus, 'success' | 'warning' | 'neutral'> = {
  verified: 'success',
  partial: 'warning',
  unverified: 'neutral',
};

interface ResearchResultsProps {
  request: ResearchRequest;
  results: ResearchResult[];
  companies: readonly Company[];
  /** Focus the heading when a job is opened, so keyboard and screen-reader users land on it. */
  focusKey: number;
}

/** Real-research stages with honest state: done / current / waiting, plus real counters. */
function ProgressPanel({ progress, onCancel, cancelling }: { progress: RealResearchProgress; onCancel: () => void; cancelling: boolean }) {
  const current = REAL_RESEARCH_STAGES.indexOf(progress.stage);
  const counter: Partial<Record<(typeof REAL_RESEARCH_STAGES)[number], string>> = {
    discovering: current > 0 ? `${progress.candidates} aday` : undefined,
    inspecting: progress.toAnalyze ? `${progress.inspected}/${progress.toAnalyze}` : undefined,
    analyzing: progress.toAnalyze ? `${progress.analyzed + progress.failed}/${progress.toAnalyze}` : undefined,
  };
  return (
    <div className="progress-panel">
      <ol className="progress-steps" aria-label="Araştırma adımları">
        {REAL_RESEARCH_STAGES.map((stage, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'waiting';
          const Icon = state === 'done' ? Check : state === 'current' ? Loader2 : Circle;
          return (
            <li key={stage} className={`progress-step progress-step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <Icon size={14} aria-hidden="true" className={state === 'current' ? 'spin' : undefined} />
              <span>{REAL_RESEARCH_STAGE_LABELS[stage]}</span>
              {counter[stage] && <span className="progress-step__count">{counter[stage]}</span>}
              <span className="visually-hidden">
                {state === 'done' ? ' (tamamlandı)' : state === 'current' ? ' (sürüyor)' : ' (bekliyor)'}
              </span>
            </li>
          );
        })}
      </ol>
      <button type="button" className="button button--secondary button--sm" onClick={onCancel} disabled={cancelling}>
        <Square size={14} aria-hidden="true" />
        {cancelling ? 'Durduruluyor…' : 'Araştırmayı Durdur'}
      </button>
    </div>
  );
}

export function ResearchResults({ request, results, companies, focusKey }: ResearchResultsProps) {
  const { toggleResult, setSelection, transferSelected, cancelRealResearch, retryFailed, runningRequestId } = useResearch();
  const showToast = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (focusKey === 0) return;
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusKey]);

  const isReal = request.mode === 'real';
  const running = request.status === 'running';
  useEffect(() => {
    if (!running) setCancelling(false);
  }, [running]);

  const rows = orderRows(
    results.map((r) => ({ result: r, status: rowStatus(r, companies, running) })),
    request.mode,
  );
  const selectable = rows.filter((x) => isSelectableStatus(x.status));
  const selectedCount = rows.filter((x) => x.status === 'selected').length;
  const addedCount = rows.filter((x) => x.status === 'added').length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;
  const retryable = results.filter((r) => r.researchStatus === 'failed' || r.researchStatus === 'discovered').length;

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

  const badge =
    request.mode === 'demo' ? (
      <Badge tone="accent">Demo araştırma sonucu</Badge>
    ) : request.provider === 'fixture' ? (
      <Badge tone="warning">Test verisi (fixture)</Badge>
    ) : (
      <Badge>Gerçek Araştırma</Badge>
    );

  const summary = isReal ? realSummary(request, results) : null;
  const detail = detailId ? results.find((r) => r.id === detailId) ?? null : null;

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
        {badge}
      </header>

      <div className="card__body research-results__body">
        {request.mode === 'demo' ? (
          <p className="demo-notice">
            <Info size={16} aria-hidden="true" />
            <span>
              Bu sonuçlar kurgusal demo verisidir. Hiçbir şirket internette araştırılmadı.
              {results.length < request.companyCount &&
                ` İstenen ${request.companyCount} şirket yerine ${results.length} temsili sonuç gösteriliyor.`}
            </span>
          </p>
        ) : (
          <p className="demo-notice demo-notice--real">
            <Info size={16} aria-hidden="true" />
            <span>
              {request.provider === 'fixture'
                ? 'Bu sonuçlar çevrimdışı test verisidir (fixture); gerçek şirketler değildir.'
                : 'Şirketler herkese açık web kaynaklarından bulundu ve siteleri sınırlı şekilde incelendi.'}{' '}
              Fırsat skorları gözlenen sinyallerden hesaplanır; doğrulama ve güven ayrı gösterilir. Detaylar ve kaynaklar için
              “Detay”a bak.
            </span>
          </p>
        )}

        {isReal && running && request.progress && (
          <ProgressPanel
            progress={request.progress}
            cancelling={cancelling}
            onCancel={() => {
              setCancelling(true);
              cancelRealResearch();
            }}
          />
        )}

        {isReal && request.errorMessage && (
          <p className={request.status === 'failed' ? 'research-alert research-alert--error' : 'research-alert'} role="alert">
            {request.errorMessage}
          </p>
        )}

        {summary && !running && summary.found > 0 && (
          <p className="research-summary" role="status">
            {summary.target} şirket hedeflendi · <strong>{summary.verified} doğrulanmış şirket bulundu</strong> ·{' '}
            {summary.analyzed} analiz edildi
            {summary.failed > 0 && ` · ${summary.failed} analiz başarısız`}
            {summary.existing > 0 && ` · ${summary.existing} zaten listede`}
          </p>
        )}

        {isReal && !running && retryable > 0 && runningRequestId === null && (
          <div className="research-retry">
            <button type="button" className="button button--secondary button--sm" onClick={() => retryFailed(request.id)}>
              <RotateCcw size={14} aria-hidden="true" />
              Analiz edilemeyen {retryable} şirketi yeniden dene
            </button>
          </div>
        )}

        {results.length === 0 ? (
          running ? null : (
            <EmptyState
              icon={SearchX}
              title="Sonuç yok"
              description={
                isReal
                  ? 'Kriterlere uyan doğrulanmış şirket bulunamadı. Sektörü veya lokasyonu genişletip yeniden dene.'
                  : 'Hariç tutma kriterleri tüm demo sonuçları eledi. Kriterleri değiştirip yeniden başlat.'
              }
            />
          )
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
                    : running
                      ? 'Analiz tamamlanan şirketler seçilebilir'
                      : 'Seçilebilecek yeni şirket kalmadı'}
              </p>
              <div className="selection-bar__actions">
                <button type="button" className="button button--ghost button--sm" onClick={clearSelection} disabled={selectedCount === 0}>
                  Seçimi Temizle
                </button>
                <button type="button" className="button button--primary" onClick={transfer} disabled={selectedCount === 0}>
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

            {isReal ? (
              <RealResultTable rows={rows} onToggle={(id) => toggleResult(request.id, id)} onDetail={setDetailId} />
            ) : (
              <DemoResultTable rows={rows} onToggle={(id) => toggleResult(request.id, id)} />
            )}
          </>
        )}
      </div>

      <ResultDetailDrawer result={detail} request={request} onClose={() => setDetailId(null)} />
    </section>
  );
}

type Row = { result: ResearchResult; status: RowStatus };

function SelectCell({ row, onToggle }: { row: Row; onToggle: (id: string) => void }) {
  return (
    <td className="col-check">
      <input
        type="checkbox"
        checked={row.status === 'selected'}
        disabled={!isSelectableStatus(row.status)}
        onChange={() => onToggle(row.result.id)}
        aria-label={`${row.result.companyName} seç`}
      />
    </td>
  );
}

function StatusCell({ status, error }: { status: RowStatus; error?: string | null }) {
  return (
    <td className="cell-status">
      <Badge tone={ROW_STATUS[status].tone} dot>
        {ROW_STATUS[status].label}
      </Badge>
      {status === 'failed' && error && <span className="result-row__error">{error}</span>}
    </td>
  );
}

function DemoResultTable({ rows, onToggle }: { rows: Row[]; onToggle: (id: string) => void }) {
  return (
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
        {rows.map((row) => {
          const r = row.result;
          return (
            <tr key={r.id} className={row.status === 'selected' ? 'result-row result-row--selected' : 'result-row'}>
              <SelectCell row={row} onToggle={onToggle} />
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
              <StatusCell status={row.status} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RealResultTable({ rows, onToggle, onDetail }: { rows: Row[]; onToggle: (id: string) => void; onDetail: (id: string) => void }) {
  return (
    <table className="result-table result-table--real">
      <thead>
        <tr>
          <th scope="col" className="col-check">
            <span className="visually-hidden">Seç</span>
          </th>
          <th scope="col">Şirket</th>
          <th scope="col" className="col-location">
            Konum
          </th>
          <th scope="col">Birincil Fırsat</th>
          <th scope="col">Fırsat Skoru</th>
          <th scope="col">Doğrulama</th>
          <th scope="col" className="col-confidence">
            Güven
          </th>
          <th scope="col">Durum</th>
          <th scope="col">
            <span className="visually-hidden">Detay</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const r = row.result;
          const primary = r.serviceOpportunities?.[0];
          return (
            <tr key={r.id} className={row.status === 'selected' ? 'result-row result-row--selected' : 'result-row'}>
              <SelectCell row={row} onToggle={onToggle} />
              <td className="cell-name">
                <span className="result-row__name">{r.companyName}</span>
                {r.website && (
                  <a className="result-row__site link" href={toExternalUrl(r.website)} target="_blank" rel="noopener noreferrer">
                    {r.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    <span className="visually-hidden"> (resmi website, yeni sekmede açılır)</span>
                  </a>
                )}
                <span className="result-row__loc">{formatLocation(r.city, r.country)}</span>
              </td>
              <td className="cell-location col-location">{formatLocation(r.city, r.country)}</td>
              <td className="cell-primary" title={r.reason || undefined}>
                {primary ? (
                  <>
                    <span className="service-tag">{SERVICES[primary.service].label}</span>
                    <span className="cell-primary__score">{primary.score}</span>
                    <span className="cell-primary__conf">{CONFIDENCE_LABELS[primary.confidence]} güven</span>
                  </>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </td>
              <td className="cell-score">
                <OpportunityScore score={r.opportunityScore} />
              </td>
              <td className="cell-verification">
                {r.verification ? (
                  <Badge tone={VERIFICATION_TONE[r.verification.status]}>{VERIFICATION_STATUS_LABELS[r.verification.status]}</Badge>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </td>
              <td className="cell-confidence col-confidence">
                {primary ? <span>{CONFIDENCE_LABELS[primary.confidence]}</span> : <span className="text-subtle">—</span>}
              </td>
              <StatusCell status={row.status} error={r.analysisError} />
              <td className="cell-detail">
                <button type="button" className="button button--ghost button--sm" onClick={() => onDetail(r.id)}>
                  {row.status === 'listed' ? 'Araştırma Bilgilerini Gör' : 'Detay'}
                  <span className="visually-hidden">: {r.companyName}</span>
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
