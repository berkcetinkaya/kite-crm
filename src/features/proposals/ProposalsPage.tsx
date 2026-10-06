// Teklifler (Phase 8): every proposal with a status filter. A new proposal starts from a company;
// a row opens the proposal (summary, edit, explicit status actions) in a drawer. Nothing is emailed,
// generated or invoiced.
import { useState } from 'react';
import { FilePlus, FileText } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Drawer } from '../../components/ui/Drawer';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { PROPOSAL_STATUS_LABELS, PROPOSAL_STATUSES, proposalServices, type ProposalStatus } from '../../domain/sales';
import { SERVICES } from '../../domain/services';
import { compareTr } from '../../lib/text';
import { formatShortDate } from '../../lib/date';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { useSales } from '../../state/sales/SalesProvider';
import { ProposalDetail } from '../sales/ProposalDetail';
import { ProposalEditor } from '../sales/ProposalEditor';
import { PROPOSAL_TONE, totalsLabel } from '../sales/salesView';
import '../sales/sales.css';

type Filter = 'all' | ProposalStatus;

export function ProposalsPage() {
  const { companies } = useCompanies();
  const { proposals, loadState, loadError } = useSales();
  const showToast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [newFor, setNewFor] = useState<string | 'pick' | null>(null);
  const byId = new Map(companies.map((c) => [c.id, c]));
  const rows = proposals.filter((p) => filter === 'all' || p.status === filter);
  const open = proposals.find((p) => p.id === openId);
  const openCompany = open ? byId.get(open.companyId) : undefined;
  const newCompany = newFor && newFor !== 'pick' ? byId.get(newFor) : undefined;
  const count = (f: Filter) => (f === 'all' ? proposals.length : proposals.filter((p) => p.status === f).length);

  return (
    <div className="page sales-page">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Teklifler</h1>
          <p className="page-header__subtitle">Şirketlere hazırladığın teklifler. KITE teklif göndermez; gönderdiğinde ve karar geldiğinde durumu sen işaretlersin.</p>
        </div>
        <button type="button" className="button button--primary" onClick={() => setNewFor('pick')}>
          <FilePlus size={16} aria-hidden="true" /> Yeni Teklif
        </button>
      </header>

      {loadError && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          Teklifler yüklenemedi: {loadError}
        </p>
      )}

      <section className="card" aria-label="Teklif listesi">
        <div className="proposal-filters" role="tablist" aria-label="Teklif durumu">
          {(['all', ...PROPOSAL_STATUSES] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'proposal-filter proposal-filter--active' : 'proposal-filter'} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Tümü' : PROPOSAL_STATUS_LABELS[f]} <span className="pipeline-group__count">{count(f)}</span>
            </button>
          ))}
        </div>
        <div className="card__body">
          {loadState === 'loading' ? (
            <p className="sales-hint">Teklifler yükleniyor…</p>
          ) : rows.length === 0 ? (
            <EmptyState icon={FileText} title="Bu filtrede teklif yok" description="Bir şirketin detayındaki Teklifler sekmesinden ya da “Yeni Teklif” ile oluştur." />
          ) : (
            <ul className="sales-list">
              {rows.map((p) => (
                <li key={p.id}>
                  <button type="button" className="sales-row" onClick={() => setOpenId(p.id)}>
                    <span className="sales-row__main">
                      <span className="sales-card__title">
                        {byId.get(p.companyId)?.name ?? 'Şirket'} · {p.title}
                      </span>
                      <span className="sales-card__meta">
                        {proposalServices(p).map((s) => SERVICES[s].shortLabel).join(' + ') || 'Kalem yok'} · {totalsLabel(p)}
                        {p.sentAt ? ` · gönderim ${formatShortDate(new Date(p.sentAt))}` : ` · güncellendi ${formatShortDate(new Date(p.updatedAt))}`}
                      </span>
                    </span>
                    <Badge tone={PROPOSAL_TONE[p.status]}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Drawer open={!!open && !!openCompany} onClose={() => setOpenId(null)} title={open ? `${openCompany?.name ?? ''} · ${open.title}` : 'Teklif'}>
        {open && openCompany && <ProposalDetail key={open.id} company={openCompany} proposal={open} />}
      </Drawer>

      <Drawer open={newFor !== null} onClose={() => setNewFor(null)} title="Yeni Teklif">
        {newFor === 'pick' ? (
          <div className="sales-form">
            <label className="field">
              <span className="field__label">Şirket</span>
              <select className="input" defaultValue="" onChange={(e) => e.target.value && setNewFor(e.target.value)}>
                <option value="" disabled>
                  Şirket seç
                </option>
                {[...companies].sort((a, b) => compareTr(a.name, b.name)).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          newCompany && (
            <ProposalEditor
              company={newCompany}
              onSaved={(p) => {
                setNewFor(null);
                setOpenId(p.id);
                showToast({ title: 'Teklif oluşturuldu', description: `${newCompany.name} · Taslak` });
              }}
              onCancel={() => setNewFor(null)}
            />
          )
        )}
      </Drawer>
    </div>
  );
}
