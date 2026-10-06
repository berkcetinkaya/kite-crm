// Satış Süreci (Phase 8): compact operational view of the sales process after a reply. Not analytics:
// who needs attention, what was offered, what is waiting for a decision, what was won or lost.
// Rows open the company drawer (Görüşmeler and Teklifler tabs) where everything is edited.
import { useState } from 'react';
import { Handshake } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { SalesStatusBadge } from '../../components/sales/SalesStatusBadge';
import { DataLoadNotice } from '../../components/ui/DataLoadNotice';
import type { Company } from '../../domain/company';
import { MEETING_TYPE_LABELS, PROPOSAL_STATUS_LABELS, type Proposal } from '../../domain/sales';
import { dayDiff, formatDateTime, formatDue, formatShortDate } from '../../lib/date';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { useSales } from '../../state/sales/SalesProvider';
import { CompanyDrawer } from '../prospects/detail/CompanyDrawer';
import { PROPOSAL_TONE, totalsLabel } from '../sales/salesView';
import '../sales/sales.css';

interface Row {
  key: string;
  companyId: string;
  title: string;
  meta: string;
  badge?: { label: string; tone: Parameters<typeof Badge>[0]['tone'] };
  stage?: Company['status'];
}

export function PipelinePage() {
  const { companies, loadState, loadError, reload } = useCompanies();
  const { meetings, proposals, loadError: salesError } = useSales();
  const [openId, setOpenId] = useState<string | null>(null);
  const now = new Date();
  const byId = new Map(companies.map((c) => [c.id, c]));
  const name = (id: string) => byId.get(id)?.name ?? 'Şirket';

  // Derived on every render from the loaded records; nothing is cached.
  const groups = (() => {
    const nowIso = now.toISOString();
    const nextAction = (c: Company) => (c.nextAction ? `Sonraki adım: ${c.nextAction.label}${c.nextAction.dueAt ? ` · ${formatDue(new Date(c.nextAction.dueAt))}` : ''}` : 'Sonraki adım belirlenmedi');
    const meetingInfo = (c: Company) => {
      const ms = meetings.filter((m) => m.companyId === c.id);
      const next = ms.filter((m) => m.status === 'planned' && m.scheduledAt >= nowIso).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
      const last = ms.find((m) => m.status === 'completed');
      return next ? `Planlı görüşme: ${formatDateTime(new Date(next.scheduledAt))} · ${MEETING_TYPE_LABELS[next.type]}` : last ? `Son görüşme: ${formatShortDate(new Date(last.scheduledAt))}` : 'Görüşme kaydı yok';
    };
    const companyRow = (c: Company): Row => ({ key: c.id, companyId: c.id, title: c.name, meta: `${meetingInfo(c)} · ${nextAction(c)}`, stage: c.status });
    const proposalRow = (p: Proposal, extra = ''): Row => ({
      key: p.id,
      companyId: p.companyId,
      title: `${name(p.companyId)} · ${p.title}`,
      meta: `${totalsLabel(p)}${extra}`,
      badge: { label: PROPOSAL_STATUS_LABELS[p.status], tone: PROPOSAL_TONE[p.status] },
    });
    return [
      { id: 'replied', title: 'Yanıt Gelenler', hint: 'Görüşme planlanabilir', rows: companies.filter((c) => c.status === 'replied').map(companyRow) },
      { id: 'meeting', title: 'Görüşmede', hint: 'Satış aşaması Görüşme', rows: companies.filter((c) => c.status === 'meeting').map(companyRow) },
      { id: 'in_progress', title: 'Teklif Hazırlanıyor', hint: 'Taslak veya gönderilmeye hazır', rows: proposals.filter((p) => p.status === 'draft' || p.status === 'ready').map((p) => proposalRow(p)) },
      {
        id: 'waiting',
        title: 'Karar Bekleyen Teklifler',
        hint: 'Gönderildi',
        rows: proposals
          .filter((p) => p.status === 'sent')
          .map((p) => proposalRow(p, `${p.sentAt ? ` · ${dayDiff(new Date(p.sentAt), now)} gün önce gönderildi` : ''}${p.validUntil ? ` · geçerlilik ${formatShortDate(new Date(p.validUntil))}` : ''}`)),
      },
      { id: 'accepted', title: 'Kabul Edilen Teklifler', hint: 'Kazanılan', rows: proposals.filter((p) => p.status === 'accepted').map((p) => proposalRow(p, p.decidedAt ? ` · ${formatShortDate(new Date(p.decidedAt))}` : '')) },
      {
        id: 'lost',
        title: 'Kaybedilenler',
        hint: 'Kaybedildi, reddedilen veya süresi dolan teklifler',
        rows: [
          ...companies.filter((c) => c.status === 'lost').map((c) => ({ ...companyRow(c), meta: nextAction(c) })),
          ...proposals.filter((p) => p.status === 'rejected' || p.status === 'expired').map((p) => proposalRow(p, p.lossReason ? ` · ${p.lossReason}` : '')),
        ],
      },
    ];
  })();

  return (
    <div className="page sales-page">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Satış Süreci</h1>
          <p className="page-header__subtitle">Yanıt gelen şirketlerde görüşmeler, teklifler ve kararlar. Aşamalar yalnızca senin seçiminle değişir.</p>
        </div>
      </header>
      {loadState !== 'ready' && <DataLoadNotice state={loadState} error={loadError} onRetry={reload} what="Şirketler" />}
      {salesError && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          Satış kayıtları yüklenemedi: {salesError}
        </p>
      )}
      <div className="pipeline-grid">
        {groups.map((g) => (
          <section key={g.id} className="card pipeline-group" aria-labelledby={`pipeline-${g.id}`}>
            <header className="card__header">
              <div className="card__heading">
                <h2 id={`pipeline-${g.id}`} className="card__title">
                  {g.title} <span className="pipeline-group__count">{g.rows.length}</span>
                </h2>
                <p className="card__subtitle">{g.hint}</p>
              </div>
            </header>
            <div className="card__body">
              {g.rows.length === 0 ? (
                <p className="sales-hint">Kayıt yok.</p>
              ) : (
                <ul className="sales-list">
                  {g.rows.map((r) => (
                    <li key={r.key}>
                      <button type="button" className="sales-row" onClick={() => setOpenId(r.companyId)}>
                        <span className="sales-row__main">
                          <span className="sales-card__title">{r.title}</span>
                          <span className="sales-card__meta">{r.meta}</span>
                        </span>
                        {r.badge ? <Badge tone={r.badge.tone}>{r.badge.label}</Badge> : r.stage && <SalesStatusBadge status={r.stage} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>
      {companies.length === 0 && loadState === 'ready' && (
        <p className="sales-hint">
          <Handshake size={14} aria-hidden="true" /> Henüz şirket yok.
        </p>
      )}
      <CompanyDrawer companyId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
