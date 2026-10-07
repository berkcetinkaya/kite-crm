// İnceleme + CRM'e Ekle (Phase 12): fast candidate review for a finished real research run. Safe bulk
// actions only (status, service, sector, add to CRM). No bulk email, no bulk drafts, no automatic
// CRM insertion: every conversion is an explicit action with explicitly selected services.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Filter, UserPlus, XCircle } from 'lucide-react';
import { errorMessage } from '../../../api/dataApi';
import { discoveryApi } from '../../../api/discoveryApi';
import { Badge } from '../../../components/ui/Badge';
import { Drawer } from '../../../components/ui/Drawer';
import { useToast } from '../../../components/ui/Toast';
import {
  CONVERTED_LABEL,
  duplicateBadgeLabel,
  PRIORITY_LABELS,
  PRIORITY_LEVELS,
  REVIEW_STATUS_LABELS,
  type CandidateView,
  type ConversionResult,
  type DiscoveryJobView,
  type PriorityLevel,
} from '../../../domain/prospecting';
import { CONFIDENCE_LABELS, type ResearchRequest } from '../../../domain/research';
import { formatLocation } from '../../../domain/locations';
import { SECTOR_LABELS } from '../../../domain/sectorTaxonomy';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../../domain/services';
import { compareTr } from '../../../lib/text';
import { websiteHost } from '../../../lib/url';
import { useCompanies } from '../../../state/companies/CompaniesProvider';
import { useResearch } from '../../../state/research/ResearchProvider';
import { CompanyDrawer } from '../../prospects/detail/CompanyDrawer';
import { CandidateDrawerBody, CONFIDENCE_TONE, PRIORITY_TONE, REVIEW_TONE } from './CandidateDrawer';

type StatusFilter = 'all' | 'unreviewed' | 'fit' | 'not_fit' | 'converted';
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = { all: 'Tümü', unreviewed: 'İncelenmedi', fit: 'Uygun', not_fit: 'Uygun Değil', converted: CONVERTED_LABEL };
const PRIORITY_ORDER: Record<PriorityLevel, number> = { high: 0, medium: 1, low: 2 };

const statusOf = (c: CandidateView): Exclude<StatusFilter, 'all'> => (c.convertedCompanyId ? 'converted' : c.review.status);

export function CandidateReview({ request }: { request: ResearchRequest }) {
  const { reload: reloadCompanies } = useCompanies();
  const { refreshJob, flushJob } = useResearch();
  const showToast = useToast();
  const [view, setView] = useState<DiscoveryJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [priority, setPriority] = useState<'all' | PriorityLevel>('all');
  const [onlyNoDup, setOnlyNoDup] = useState(false);
  const [onlyContact, setOnlyContact] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [convertIds, setConvertIds] = useState<string[] | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkSector, setBulkSector] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // The run's results are saved by the browser in small batches: write them first, then read.
      await flushJob(request.id);
      setView(await discoveryApi.job(request.id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [request.id, flushJob]);

  useEffect(() => {
    void load();
  }, [load, request.updatedAt, request.resultCount]);

  const candidates = useMemo(() => view?.candidates ?? [], [view]);
  const rows = useMemo(
    () =>
      candidates
        .filter((c) => status === 'all' || statusOf(c) === status)
        .filter((c) => priority === 'all' || c.priority.level === priority)
        .filter((c) => !onlyNoDup || !c.duplicates.blocksConversion)
        .filter((c) => !onlyContact || c.channels.length > 0)
        .sort((a, b) => PRIORITY_ORDER[a.priority.level] - PRIORITY_ORDER[b.priority.level] || (b.result.rankScore ?? 0) - (a.result.rankScore ?? 0) || compareTr(a.result.companyName, b.result.companyName)),
    [candidates, status, priority, onlyNoDup, onlyContact],
  );
  const open = candidates.find((c) => c.result.id === openId) ?? null;
  const selectedRows = candidates.filter((c) => selected.has(c.result.id) && !c.convertedCompanyId);
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const replace = (next: CandidateView) => {
    const before = candidates.find((c) => c.result.id === next.result.id);
    setView((v) => (v ? { ...v, candidates: v.candidates.map((c) => (c.result.id === next.result.id ? next : c)) } : v));
    // Re-research rewrote the stored result: refresh the browser copy so a later save cannot write the old snapshot back.
    if (before && JSON.stringify(next.result) !== JSON.stringify(before.result)) void refreshJob(request.id);
  };

  const bulk = async (action: Parameters<typeof discoveryApi.bulk>[1], label: string) => {
    if (selectedRows.length === 0) return;
    setBusy(true);
    try {
      const out = await discoveryApi.bulk(selectedRows.map((c) => c.result.id), action);
      const failed = out.results.filter((r) => !r.ok);
      setSelected(new Set());
      showToast({ title: label, description: failed.length ? `${out.results.length - failed.length} güncellendi · ${failed.length} güncellenemedi (${failed[0].message})` : `${out.results.length} aday güncellendi` });
      await load();
    } catch (e) {
      showToast({ title: 'Toplu işlem yapılamadı', description: errorMessage(e) });
    }
    setBusy(false);
  };

  if (error) return <p className="research-alert research-alert--error" role="alert">Adaylar yüklenemedi: {error}</p>;
  if (!view) return <p className="sales-hint">Adaylar yükleniyor…</p>;
  if (candidates.length === 0) return <p className="sales-hint">Adaylar hazırlanıyor…</p>;

  const c = view.counts;
  return (
    <div className="candidate-review">
      <div className="candidate-review__summary" role="status">
        <span>{c.total} aday</span>
        <span>· {c.unreviewed} incelenmedi</span>
        <span>· {c.fit} uygun</span>
        <span>· {c.notFit} uygun değil</span>
        <span>· {c.converted} CRM'e eklendi</span>
        {view.reviewed && <Badge tone="success">İncelendi</Badge>}
        {view.details && (
          <span className="sales-hint">
            · {view.details.searchesUsed} arama kullanıldı{view.details.provider === 'fixture' ? ' (test)' : ''}
          </span>
        )}
      </div>

      <div className="candidate-review__filters" aria-label="Aday filtreleri">
        <Filter size={14} aria-hidden="true" />
        <div className="chip-row" role="group" aria-label="İnceleme durumu">
          {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} className={status === s ? 'filter-chip filter-chip--on' : 'filter-chip'} onClick={() => setStatus(s)}>
              {STATUS_FILTER_LABELS[s]}
            </button>
          ))}
        </div>
        <select className="input input--sm" aria-label="Öncelik" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
          <option value="all">Tüm öncelikler</option>
          {PRIORITY_LEVELS.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <label className="stage-move__check">
          <input type="checkbox" checked={onlyNoDup} onChange={(e) => setOnlyNoDup(e.target.checked)} />
          <span>CRM'de olmayanlar</span>
        </label>
        <label className="stage-move__check">
          <input type="checkbox" checked={onlyContact} onChange={(e) => setOnlyContact(e.target.checked)} />
          <span>İletişimi olanlar</span>
        </label>
      </div>

      {selectedRows.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Toplu inceleme">
          <span className="bulk-bar__count">{selectedRows.length} aday seçildi</span>
          <button type="button" className="button button--secondary button--sm" disabled={busy} onClick={() => void bulk({ type: 'status', status: 'fit' }, 'Uygun olarak işaretlendi')}>
            <CheckCircle2 size={14} aria-hidden="true" /> Uygun
          </button>
          <input className="input input--sm" aria-label="Uygun değil nedeni" placeholder="Uygun değil nedeni" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} />
          <button type="button" className="button button--secondary button--sm" disabled={busy || !bulkReason.trim()} onClick={() => void bulk({ type: 'status', status: 'not_fit', rejectReason: bulkReason.trim() }, 'Uygun değil olarak işaretlendi')}>
            <XCircle size={14} aria-hidden="true" /> Uygun Değil
          </button>
          <select className="input input--sm" aria-label="Hizmet ata" value="" onChange={(e) => e.target.value && void bulk({ type: 'services', services: [e.target.value as ServiceKey] }, 'Hizmet atandı')}>
            <option value="">Hizmet ata…</option>
            {SERVICE_KEYS.map((s) => (
              <option key={s} value={s}>
                {SERVICES[s].label}
              </option>
            ))}
          </select>
          <input className="input input--sm" aria-label="Sektör ata" list="bulk-sectors" placeholder="Sektör ata" value={bulkSector} onChange={(e) => setBulkSector(e.target.value)} />
          <datalist id="bulk-sectors">
            {SECTOR_LABELS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <button type="button" className="button button--secondary button--sm" disabled={busy || !bulkSector.trim()} onClick={() => void bulk({ type: 'sector', sector: bulkSector.trim(), sectorId: null }, 'Sektör atandı')}>
            Sektörü uygula
          </button>
          <button type="button" className="button button--primary button--sm" disabled={busy} onClick={() => setConvertIds(selectedRows.map((x) => x.result.id))}>
            <UserPlus size={14} aria-hidden="true" /> Seçilenleri CRM'e ekle
          </button>
        </div>
      )}

      <div className="candidate-table-wrap">
        <table className="candidate-table">
          <thead>
            <tr>
              <th scope="col" className="candidate-table__check">
                <span className="visually-hidden">Seç</span>
              </th>
              <th scope="col">Şirket</th>
              <th scope="col">Konum</th>
              <th scope="col">Önerilen hizmet</th>
              <th scope="col">Öncelik</th>
              <th scope="col">Güven</th>
              <th scope="col">Tekrar</th>
              <th scope="col">İletişim</th>
              <th scope="col">Durum</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const r = x.result;
              const st = statusOf(x);
              return (
                <tr key={r.id} className={x.convertedCompanyId ? 'candidate-table__row--done' : undefined}>
                  <td className="candidate-table__check">
                    <input type="checkbox" aria-label={`${r.companyName} seç`} disabled={!!x.convertedCompanyId} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <th scope="row">
                    <button type="button" className="link-cell" onClick={() => setOpenId(r.id)}>
                      {r.companyName}
                    </button>
                    <span className="candidate-table__domain">{websiteHost(r.website) ?? 'website yok'}</span>
                  </th>
                  <td>{formatLocation(r.city, r.country)}</td>
                  <td>{x.defaultServices.length ? x.defaultServices.map((s) => SERVICES[s].shortLabel).join(', ') : <span className="text-subtle">—</span>}</td>
                  <td>
                    <Badge tone={PRIORITY_TONE[x.priority.level]}>{PRIORITY_LABELS[x.priority.level]}</Badge>
                  </td>
                  <td>
                    <Badge tone={CONFIDENCE_TONE[x.confidence.level]}>{CONFIDENCE_LABELS[x.confidence.level]}</Badge>
                  </td>
                  <td>{x.duplicates.level ? <Badge tone={x.duplicates.level === 'hard' ? 'danger' : x.duplicates.level === 'probable' ? 'warning' : 'info'}>{duplicateBadgeLabel(x.duplicates)}</Badge> : <span className="text-subtle">—</span>}</td>
                  <td>{x.channels.length ? x.channels.join(', ') : <span className="text-subtle">yok</span>}</td>
                  <td>{st === 'converted' ? <Badge tone="success">{CONVERTED_LABEL}</Badge> : <Badge tone={REVIEW_TONE[st]}>{REVIEW_STATUS_LABELS[st]}</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="sales-hint candidate-review__empty">Bu filtrelerle aday yok.</p>}
      </div>

      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open ? `${open.result.companyName} · Neden bu firma?` : 'Aday'}>
        {open && (
          <>
            <CandidateDrawerBody key={`${open.result.id}-${open.review.updatedAt}`} candidate={open} onChanged={replace} onOpenCompany={setCompanyId} />
            {!open.convertedCompanyId && (
              <div className="candidate__convert">
                <button type="button" className="button button--primary" onClick={() => setConvertIds([open.result.id])}>
                  <UserPlus size={16} aria-hidden="true" /> CRM'e ekle
                </button>
              </div>
            )}
          </>
        )}
      </Drawer>

      <Drawer open={convertIds !== null} onClose={() => setConvertIds(null)} title="CRM'e ekle">
        {convertIds && (
          <ConvertDialog
            candidates={candidates.filter((x) => convertIds.includes(x.result.id))}
            onDone={async (results) => {
              const ok = results.filter((r) => r.ok && r.status === 'converted').length;
              showToast({ title: ok ? `${ok} şirket CRM'e eklendi` : 'Yeni şirket eklenmedi', description: results.some((r) => !r.ok) ? 'Bazı adaylar eklenemedi; nedenleri listede.' : 'Durum: Bulundu · Kaynak: Araştırma' });
              setSelected(new Set());
              await load();
              reloadCompanies();
              void refreshJob(request.id);
            }}
            onClose={() => setConvertIds(null)}
          />
        )}
      </Drawer>

      <CompanyDrawer companyId={companyId} onClose={() => setCompanyId(null)} />
    </div>
  );
}

/** Confirmation step: explicit services per candidate, then per-candidate results. */
function ConvertDialog({ candidates, onDone, onClose }: { candidates: CandidateView[]; onDone: (r: ConversionResult[]) => Promise<void>; onClose: () => void }) {
  const [services, setServices] = useState<Record<string, ServiceKey[]>>(() => Object.fromEntries(candidates.map((c) => [c.result.id, c.review.services ?? c.defaultServices])));
  const [results, setResults] = useState<ConversionResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string, s: ServiceKey) => setServices((m) => ({ ...m, [id]: (m[id] ?? []).includes(s) ? m[id].filter((x) => x !== s) : [...(m[id] ?? []), s] }));
  const convertible = candidates.filter((c) => !c.convertedCompanyId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await discoveryApi.convert(convertible.map((c) => ({ resultId: c.result.id, services: services[c.result.id] ?? [] })));
      setResults(out.results);
      await onDone(out.results);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  if (results) {
    return (
      <div className="convert-dialog">
        <ul className="convert-results">
          {results.map((r) => {
            const c = candidates.find((x) => x.result.id === r.resultId);
            return (
              <li key={r.resultId} className={r.ok ? 'convert-results__ok' : 'convert-results__fail'}>
                <strong>{c?.result.companyName ?? r.resultId}</strong>: {r.message}
              </li>
            );
          })}
        </ul>
        <div className="form-actions">
          <button type="button" className="button button--primary button--sm" onClick={onClose}>
            Kapat
          </button>
          <a className="button button--ghost button--sm" href="#/prospects">
            Potansiyel Müşteriler'de gör
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="convert-dialog">
      <p className="sales-hint">Her aday ayrı kaydedilir: biri eklenemezse diğerleri etkilenmez. Şirketler “Bulundu” aşamasında açılır; mail, takip veya taslak oluşturulmaz. Yalnızca işaretli hizmetler fırsat olarak eklenir.</p>
      <ul className="convert-list">
        {convertible.map((c) => (
          <li key={c.result.id} className="convert-list__item">
            <p className="convert-list__name">
              <strong>{c.result.companyName}</strong> <Badge tone={PRIORITY_TONE[c.priority.level]}>{PRIORITY_LABELS[c.priority.level]}</Badge>
              {c.duplicates.blocksConversion && <Badge tone="danger">CRM'de mevcut: eklenmeyecek</Badge>}
              {c.duplicates.needsConfirmation && <Badge tone="warning">Muhtemel tekrar: önce “Farklı şirket” onayı gerekli</Badge>}
              {c.review.status === 'not_fit' && <Badge tone="danger">Uygun Değil: eklenmeyecek (önce kararı değiştir)</Badge>}
            </p>
            <div className="service-checks">
              {SERVICE_KEYS.map((s) => (
                <label key={s} className="stage-move__check">
                  <input type="checkbox" checked={(services[c.result.id] ?? []).includes(s)} onChange={() => toggle(c.result.id, s)} />
                  <span>
                    {SERVICES[s].shortLabel}
                    {c.defaultServices.includes(s) && <span className="sales-hint"> · önerilen</span>}
                  </span>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button button--primary button--sm" onClick={() => void submit()} disabled={busy || convertible.length === 0}>
          <UserPlus size={14} aria-hidden="true" /> {convertible.length} adayı CRM'e ekle
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={onClose} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}
