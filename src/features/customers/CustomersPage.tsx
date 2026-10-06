// Müşteriler (Phase 9): customers after onboarding started. List with status filters on the left,
// the selected customer on the right. Companies at Müşteri without a record are listed so onboarding
// can be started; nothing is created, activated or completed on its own.
import { useEffect, useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { readHashParams } from '../../app/useHashRoute';
import { Badge } from '../../components/ui/Badge';
import { Drawer } from '../../components/ui/Drawer';
import { EmptyState } from '../../components/ui/EmptyState';
import { CUSTOMER_STATUS_LABELS, CUSTOMER_STATUSES, customerBlockers, onboardingProgress, serviceDisplayName, type CustomerStatus } from '../../domain/customers';
import { SALES_STATUS } from '../../domain/salesStatus';
import { compareTr } from '../../lib/text';
import { formatShortDate } from '../../lib/date';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { useCustomers } from '../../state/customers/CustomersProvider';
import { CompanyDrawer } from '../prospects/detail/CompanyDrawer';
import { CustomerDetail } from './CustomerDetail';
import { CLIENTS_ROUTE, CUSTOMER_TONE, ProgressBar } from './customersView';
import { StartOnboarding } from './StartOnboarding';
import '../sales/sales.css';
import './customers.css';

type Filter = 'all' | CustomerStatus;
interface StartRequest {
  companyId: string | 'pick';
  proposalId: string | null;
}

export function CustomersPage() {
  const { companies } = useCompanies();
  const { customers, loadState, loadError } = useCustomers();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [start, setStart] = useState<StartRequest | null>(null);
  const [companyOpen, setCompanyOpen] = useState<string | null>(null);

  // Deep links: "#/clients?customer=<id>" and "#/clients?start=<companyId>&proposal=<id>".
  useEffect(() => {
    const read = () => {
      const p = readHashParams();
      const customer = p.get('customer');
      const startFor = p.get('start');
      if (customer) setSelectedId(customer);
      if (startFor) setStart({ companyId: startFor, proposalId: p.get('proposal') });
      if (customer || startFor) {
        setCompanyOpen(null);
        window.history.replaceState(null, '', CLIENTS_ROUTE);
      }
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const byId = new Map(companies.map((c) => [c.id, c]));
  const nowIso = new Date().toISOString();
  const rows = customers.filter((c) => filter === 'all' || c.status === filter).sort((a, b) => compareTr(byId.get(a.companyId)?.name ?? '', byId.get(b.companyId)?.name ?? ''));
  const withoutRecord = companies.filter((c) => c.status === 'client' && !customers.some((x) => x.companyId === c.id)).sort((a, b) => compareTr(a.name, b.name));
  const selected = customers.find((c) => c.id === selectedId) ?? (selectedId === null ? rows[0] : undefined);
  const selectedCompany = selected ? byId.get(selected.companyId) : undefined;
  const count = (f: Filter) => (f === 'all' ? customers.length : customers.filter((c) => c.status === f).length);
  const startCompany = start && start.companyId !== 'pick' ? byId.get(start.companyId) : undefined;
  const existingForStart = startCompany ? customers.find((c) => c.companyId === startCompany.id) : undefined;

  return (
    <div className="page sales-page customers-page">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Müşteriler</h1>
          <p className="page-header__subtitle">Onboarding, hizmetler ve erişim takibi. Her adımı sen işaretlersin; KITE fatura kesmez, şifre saklamaz.</p>
        </div>
        <button type="button" className="button button--primary" onClick={() => setStart({ companyId: 'pick', proposalId: null })}>
          <UserPlus size={16} aria-hidden="true" /> Onboarding Başlat
        </button>
      </header>

      {loadError && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          Müşteriler yüklenemedi: {loadError}
        </p>
      )}

      {withoutRecord.length > 0 && (
        <section className="card customers-pending" aria-label="Müşteri aşamasında, kaydı yok">
          <div className="card__body">
            <h2 className="customer-section-title">Müşteri aşamasında, kaydı yok</h2>
            <ul className="customers-pending__list">
              {withoutRecord.map((c) => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  <button type="button" className="button button--secondary button--sm" onClick={() => setStart({ companyId: c.id, proposalId: null })}>
                    Onboarding'i başlat
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <div className="customers-layout">
        <section className="card" aria-label="Müşteri listesi">
          <div className="proposal-filters" role="tablist" aria-label="Müşteri durumu">
            {(['all', ...CUSTOMER_STATUSES] as Filter[]).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'proposal-filter proposal-filter--active' : 'proposal-filter'} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Tümü' : CUSTOMER_STATUS_LABELS[f]} <span className="pipeline-group__count">{count(f)}</span>
              </button>
            ))}
          </div>
          <div className="card__body">
            {loadState === 'loading' ? (
              <p className="sales-hint">Müşteriler yükleniyor…</p>
            ) : rows.length === 0 ? (
              <EmptyState icon={Users} title="Bu filtrede müşteri yok" description="Kabul edilen bir tekliften ya da “Onboarding Başlat” ile müşteri kaydı aç." />
            ) : (
              <ul className="sales-list">
                {rows.map((c) => {
                  const progress = onboardingProgress(c.onboarding);
                  const blocked = customerBlockers(c, nowIso).length > 0;
                  return (
                    <li key={c.id}>
                      <button type="button" className={`sales-row${selected?.id === c.id ? ' sales-row--active' : ''}`} aria-current={selected?.id === c.id ? 'true' : undefined} onClick={() => setSelectedId(c.id)}>
                        <span className="sales-row__main">
                          <span className="sales-card__title">{byId.get(c.companyId)?.name ?? 'Şirket'}</span>
                          <span className="sales-card__meta">
                            {c.services.length ? c.services.map(serviceDisplayName).join(', ') : 'Hizmet yok'} · başlangıç {formatShortDate(new Date(c.startDate))}
                          </span>
                          {c.status === 'onboarding' && <ProgressBar done={progress.done} total={progress.total} />}
                        </span>
                        <span className="customer-row__badges">
                          {blocked && <Badge tone="danger">Engel var</Badge>}
                          <Badge tone={CUSTOMER_TONE[c.status]}>{CUSTOMER_STATUS_LABELS[c.status]}</Badge>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="card customers-detail-card" aria-label="Müşteri detayı">
          <div className="card__body">
            {selected && selectedCompany ? (
              <CustomerDetail key={selected.id} customer={selected} company={selectedCompany} onOpenCompany={() => setCompanyOpen(selectedCompany.id)} />
            ) : (
              <EmptyState icon={Users} title="Müşteri seç" description={selectedId && loadState === 'ready' ? 'Bu müşteri bulunamadı.' : 'Soldaki listeden bir müşteri seç.'} />
            )}
          </div>
        </section>
      </div>

      <Drawer open={start !== null} onClose={() => setStart(null)} title={startCompany ? `${startCompany.name} · Onboarding başlat` : "Müşteri onboarding'ini başlat"}>
        {start?.companyId === 'pick' ? (
          <div className="sales-form">
            <label className="field">
              <span className="field__label">Şirket</span>
              <select className="input" defaultValue="" onChange={(e) => e.target.value && setStart({ companyId: e.target.value, proposalId: null })}>
                <option value="" disabled>
                  Şirket seç
                </option>
                {companies
                  .filter((c) => !customers.some((x) => x.companyId === c.id))
                  .sort((a, b) => compareTr(a.name, b.name))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {SALES_STATUS[c.status].label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ) : existingForStart ? (
          <div className="sales-form">
            <p className="sales-hint">Bu şirketin zaten müşteri kaydı var ({CUSTOMER_STATUS_LABELS[existingForStart.status]}).</p>
            <button
              type="button"
              className="button button--secondary button--sm"
              onClick={() => {
                setSelectedId(existingForStart.id);
                setStart(null);
              }}
            >
              Müşteri kaydını aç
            </button>
          </div>
        ) : startCompany ? (
          <StartOnboarding
            key={startCompany.id}
            company={startCompany}
            proposalId={start?.proposalId ?? null}
            onStarted={(c) => {
              setStart(null);
              setFilter('all');
              setSelectedId(c.id);
            }}
            onCancel={() => setStart(null)}
          />
        ) : (
          start && <p className="sales-hint">Şirket bulunamadı.</p>
        )}
      </Drawer>

      <CompanyDrawer companyId={companyOpen} onClose={() => setCompanyOpen(null)} />
    </div>
  );
}
