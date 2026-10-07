import { useEffect, useState } from 'react';
import { ExternalLink, Mail } from 'lucide-react';
import { useMailDrafts } from '../../../state/mail/MailDraftsProvider';
import { MAIL_DRAFT_STATUS_LABELS } from '../../../domain/mail/draft';
import { mailHref } from '../../mail/routes';
import { Drawer } from '../../../components/ui/Drawer';
import { Tabs, type TabItem } from '../../../components/ui/Tabs';
import { OpportunityScore } from '../../../components/sales/OpportunityScore';
import { SalesStatusBadge } from '../../../components/sales/SalesStatusBadge';
import type { Company } from '../../../domain/company';
import { formatDue, formatRelativePast } from '../../../lib/date';
import { toExternalUrl } from '../../../lib/url';
import { useCompanies } from '../../../state/companies/CompaniesProvider';
import { StatusSelect } from './StatusSelect';
import { OverviewSection } from './OverviewSection';
import { OpportunitiesSection } from './OpportunitiesSection';
import { ContactsSection } from './ContactsSection';
import { NotesSection } from './NotesSection';
import { HistorySection } from './HistorySection';
import { companySectorLabel } from '../query';
import { CommunicationSummary } from './CommunicationSummary';
import { MeetingsSection } from '../../sales/MeetingsSection';
import { ProposalsSection } from '../../sales/ProposalsSection';
import { SalesSummary } from '../../sales/SalesSummary';
import { useSales } from '../../../state/sales/SalesProvider';
import { CustomerSummaryCard } from '../../customers/customersView';
import { TasksCard } from './TasksCard';
import { outreachPrepApi } from '../../../api/outreachPrepApi';
import { READINESS_LABELS, type Readiness } from '../../../domain/outreachReadiness';

type SectionId = 'overview' | 'meetings' | 'proposals' | 'opportunities' | 'contacts' | 'notes' | 'history';

interface CompanyDrawerProps {
  companyId: string | null;
  onClose: () => void;
}

export function CompanyDrawer({ companyId, onClose }: CompanyDrawerProps) {
  const { companies } = useCompanies();
  const company = companies.find((c) => c.id === companyId) ?? null;

  return (
    <Drawer
      open={company !== null}
      onClose={onClose}
      title={company?.name ?? 'Şirket'}
      header={company && <CompanyHeader company={company} />}
    >
      {/* Keyed by id so tab, edit mode and drafts reset when another company opens. */}
      {company && <CompanyDetail key={company.id} company={company} />}
    </Drawer>
  );
}

function CompanyHeader({ company }: { company: Company }) {
  const now = new Date();
  const location = [company.city, company.country].filter(Boolean).join(', ');
  return (
    <div className="company-header">
      <p className="company-header__name" aria-hidden="true">
        {company.name}
      </p>
      <p className="company-header__meta">
        {company.website && (
          <a href={toExternalUrl(company.website)} target="_blank" rel="noopener noreferrer" className="link">
            {company.website}
            <ExternalLink size={12} aria-hidden="true" />
            <span className="visually-hidden"> (yeni sekmede açılır)</span>
          </a>
        )}
        <span>{[companySectorLabel(company), location].filter(Boolean).join(' · ')}</span>
      </p>
      <dl className="company-facts">
        <div>
          <dt>Durum</dt>
          <dd>
            <SalesStatusBadge status={company.status} />
          </dd>
        </div>
        <div>
          <dt>Fırsat Skoru</dt>
          <dd>
            <OpportunityScore score={company.opportunityScore} />
          </dd>
        </div>
        <div>
          <dt>Sorumlu</dt>
          <dd>{company.owner ?? <span className="text-subtle">Atanmadı</span>}</dd>
        </div>
        <div>
          <dt>Son Temas</dt>
          <dd>
            {company.lastContactAt ? (
              formatRelativePast(new Date(company.lastContactAt), now)
            ) : (
              <span className="text-subtle">Henüz yok</span>
            )}
          </dd>
        </div>
        <div className="company-facts__wide">
          <dt>Sonraki Adım</dt>
          <dd>
            {company.nextAction ? (
              <>
                {company.nextAction.label}
                {company.nextAction.dueAt && (
                  <span className="text-muted"> · {formatDue(new Date(company.nextAction.dueAt), now)}</span>
                )}
              </>
            ) : (
              <span className="text-subtle">Belirlenmedi</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="company-header__actions">
        <StatusSelect company={company} />
        <MailDraftButton companyId={company.id} />
      </div>
      <OutreachReadinessLine company={company} />
    </div>
  );
}

/** Phase 13: one line of outreach readiness (computed by the server) with a link to Hazırlık. */
function OutreachReadinessLine({ company }: { company: Company }) {
  const { draftFor } = useMailDrafts();
  const draft = draftFor(company.id);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    outreachPrepApi
      .detail(company.id, controller.signal)
      .then((d) => setReadiness(d.readiness))
      .catch(() => setReadiness(null));
    return () => controller.abort();
  }, [company.id, company.updatedAt, draft?.updatedAt]);
  if (!readiness) return null;
  const extra = readiness.state === 'ready' ? '' : readiness.reasons.length === 1 ? ` · ${readiness.reasons[0].message}` : ` · ${readiness.reasons.length} neden`;
  return (
    <p className={`company-header__outreach company-header__outreach--${readiness.state}`}>
      Outreach: <strong>{READINESS_LABELS[readiness.state]}</strong>
      {extra} · <a href={mailHref(company.id)}>Hazırlığı aç</a>
    </p>
  );
}

/** Opens Mail & Takip with this company; shows the existing draft instead of creating another. */
function MailDraftButton({ companyId }: { companyId: string }) {
  const { draftFor } = useMailDrafts();
  const draft = draftFor(companyId);
  return (
    <a className="button button--secondary button--sm company-header__mail" href={mailHref(companyId)}>
      <Mail size={14} aria-hidden="true" />
      {draft ? `Mail Taslağını Aç (${MAIL_DRAFT_STATUS_LABELS[draft.status]})` : 'Mail Taslağı Hazırla'}
    </a>
  );
}

function CompanyDetail({ company }: { company: Company }) {
  const [section, setSection] = useState<SectionId>('overview');
  const { meetingsFor, proposalsFor } = useSales();
  const tabs: TabItem<SectionId>[] = [
    { id: 'overview', label: 'Genel Bakış' },
    { id: 'meetings', label: 'Görüşmeler', count: meetingsFor(company.id).length },
    { id: 'proposals', label: 'Teklifler', count: proposalsFor(company.id).length },
    { id: 'opportunities', label: 'Fırsatlar', count: company.opportunities.length },
    { id: 'contacts', label: 'İletişim', count: company.contacts.length },
    { id: 'notes', label: 'Notlar', count: company.notes.length },
    { id: 'history', label: 'Geçmiş', count: company.history.length },
  ];

  return (
    <Tabs
      items={tabs}
      active={section}
      onChange={setSection}
      label="Şirket detayı"
      renderPanel={(id) => {
        switch (id) {
          case 'overview':
            return (
              <>
                <CustomerSummaryCard company={company} />
                <TasksCard company={company} />
                <SalesSummary company={company} />
                <CommunicationSummary company={company} />
                <OverviewSection company={company} />
              </>
            );
          case 'meetings':
            return <MeetingsSection company={company} />;
          case 'proposals':
            return <ProposalsSection company={company} />;
          case 'opportunities':
            return <OpportunitiesSection company={company} />;
          case 'contacts':
            return <ContactsSection company={company} />;
          case 'notes':
            return <NotesSection company={company} />;
          case 'history':
            return <HistorySection company={company} />;
        }
      }}
    />
  );
}
