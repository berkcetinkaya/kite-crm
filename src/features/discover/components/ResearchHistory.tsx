import { History } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { RESEARCH_STATUS, type ResearchRequest, type ResearchResult } from '../../../domain/research';
import { realSummary } from '../resultView';
import { SERVICES } from '../../../domain/services';
import { formatShortDate } from '../../../lib/date';
import { sectorLabel } from '../../../domain/sectorTaxonomy';

interface ResearchHistoryProps {
  requests: ResearchRequest[];
  resultsByRequest: Record<string, ResearchResult[]>;
  activeId: string | null;
  onOpen: (id: string) => void;
}

export function ResearchHistory({ requests, resultsByRequest, activeId, onOpen }: ResearchHistoryProps) {
  return (
    <section className="card research-history" aria-labelledby="research-history-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="research-history-title" className="card__title">
            Son Araştırmalar
          </h2>
          <p className="card__subtitle">Bu oturumda başlattığın araştırmalar. Sayfa yenilenince sıfırlanır.</p>
        </div>
      </header>
      {requests.length === 0 ? (
        <div className="card__body">
          <EmptyState
            icon={History}
            title="Henüz araştırma yok"
            description="Kriterleri doldurup ilk araştırmayı başlattığında burada listelenecek."
          />
        </div>
      ) : (
        <div className="card__body card__body--flush">
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">Araştırma</th>
                <th scope="col" className="col-h-service">
                  Hizmet
                </th>
                <th scope="col" className="col-h-sector">
                  Sektör
                </th>
                <th scope="col" className="col-h-country">
                  Ülke
                </th>
                <th scope="col" className="col-h-city">
                  Şehir
                </th>
                <th scope="col" className="col-h-num">
                  Hedef
                </th>
                <th scope="col" className="col-h-num" title="Demo: oluşturulan sonuç · Gerçek: bulunan şirket (doğrulama durumu sonuç listesinde)">
                  Sonuç
                </th>
                <th scope="col" className="col-h-num">
                  Analiz
                </th>
                <th scope="col" className="col-h-num">
                  Eklenen
                </th>
                <th scope="col" className="col-h-date">
                  Tarih
                </th>
                <th scope="col">Durum</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((q) => {
                const results = resultsByRequest[q.id] ?? [];
                const added = results.filter((r) => r.transferredCompanyId).length;
                const summary = q.mode === 'real' ? realSummary(q, results) : null;
                const active = q.id === activeId;
                const typeLabel = q.mode === 'demo' ? 'Demo' : q.provider === 'fixture' ? 'Test' : 'Gerçek';
                const statusLabel = q.cancelled ? 'Durduruldu' : RESEARCH_STATUS[q.status];
                const statusTone =
                  q.status === 'failed' ? 'danger' : q.status === 'running' ? 'accent' : q.cancelled ? 'neutral' : 'success';
                return (
                  <tr key={q.id} className={active ? 'history-row history-row--active' : 'history-row'} onClick={() => onOpen(q.id)}>
                    <td>
                      <button
                        type="button"
                        className="history-row__name"
                        aria-current={active ? 'true' : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(q.id);
                        }}
                      >
                        {q.name}
                      </button>
                      <span className={q.mode === 'demo' ? 'history-row__demo' : 'history-row__demo history-row__demo--real'}>
                        {typeLabel}
                      </span>
                    </td>
                    <td className="col-h-service">{SERVICES[q.service].label}</td>
                    <td className="col-h-sector">{sectorLabel(q.sector, q.sectorId)}</td>
                    <td className="col-h-country">{q.country}</td>
                    <td className="col-h-city">{q.city ?? <span className="text-muted">Tüm şehirler</span>}</td>
                    <td className="col-h-num">{q.companyCount}</td>
                    <td className="col-h-num">{summary ? summary.found : q.resultCount}</td>
                    <td className="col-h-num">{summary ? summary.analyzed : '—'}</td>
                    <td className="col-h-num">{added}</td>
                    <td className="col-h-date text-muted">{formatShortDate(new Date(q.createdAt))}</td>
                    <td>
                      <Badge tone={statusTone} dot>
                        {statusLabel}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
