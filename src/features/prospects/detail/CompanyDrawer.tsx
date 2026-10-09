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
import { salesIntelligenceApi } from '../../../api/salesIntelligenceApi';
import type { SalesInsight } from '../../../domain/salesIntelligence';
import { activityText, ActionLink, MomentumBadge, PlannedLine, PriorityBadge, Reasons, type CompanySection } from '../../sales/intelligenceView';

type SectionId = 'overview' | 'meetings' | 'proposals' | 'opportunities' | 'contacts' | 'notes' | 'history';

interface CompanyDrawerProps {
  companyId: string | null;
  onClose: () => void;
  /** Tab to open first (Phase 14 recommended actions link to Görüşmeler, Teklifler or İletişim). */
  initialSection?: CompanySection;
}

export function CompanyDrawer({ companyId, onClose, initialSection }: CompanyDrawerProps) {
  const { companies } = useCompanies();
  const company = companies.find((c) => c.id === companyId) ?? null;
  const [section, setSection] = useState<SectionId>(initialSection ?? 'overview');
  // Another company (or another requested tab) starts on its own tab.
  useEffect(() => setSection(initialSection ?? 'overview'), [companyId, initialSection]);

  return (
    <Drawer
      open={company !== null}
      onClose={onClose}
      title={company?.name ?? 'Şirket'}
      header={company && <CompanyHeader company={company} onSection={setSection} />}
    >
      {/* Keyed by id so edit mode and drafts reset when another company opens. */}
      {company && <CompanyDetail key={company.id} company={company} section={section} onSection={setSection} />}
    </Drawer>
  );
}

function CompanyHeader({ company, onSection }: { company: Company; onSection: (s: SectionId) => void }) {
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
      <SalesStatusBlock company={company} onSection={onSection} />
    </div>
  );
}

/**
 * Satış Durumu (Phase 14): priority, momentum, the recommended next step (advisory) next to the
 * user's own planned step, reasons, blockers and the last meaningful activity. Includes the Phase 13
 * outreach readiness for companies not contacted yet, so there is one status block, not two.
 */
function SalesStatusBlock({ company, onSection }: { company: Company; onSection: (s: SectionId) => void }) {
  const { draftFor } = useMailDrafts();
  const { meetingsFor, proposalsFor } = useSales();
  const draft = draftFor(company.id);
  const meetingKey = meetingsFor(company.id).map((m) => m.updatedAt).join();
  const proposalKey = proposalsFor(company.id).map((p) => p.updatedAt).join();
  const [insight, setInsight] = useState<SalesInsight | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    salesIntelligenceApi
      .company(company.id, controller.signal)
      .then((i) => {
        setInsight(i);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [company.id, company.updatedAt, draft?.updatedAt, meetingKey, proposalKey]);
  if (failed) return <p className="si-block si-block--muted">Satış durumu yüklenemedi.</p>;
  if (!insight) return <p className="si-block si-block--muted" aria-busy="true">Satış durumu hazırlanıyor…</p>;
  if (insight.excluded) return <p className="si-block si-block--muted">{insight.excluded}</p>;
  const open = (_id: string, s?: CompanySection) => onSection(s ?? 'overview');
  return (
    <section className="si-block" aria-label="Satış Durumu">
      <div className="si-block__head">
        <span className="si-block__title">Satış Durumu</span>
        {insight.priority && <PriorityBadge level={insight.priority.level} />}
        {insight.momentum && <MomentumBadge state={insight.momentum.state} />}
      </div>
      {insight.action ? (
        <div className="si-block__action">
          <ActionLink action={insight.action} onOpenCompany={open} />
          {insight.action.detail && <span className="text-muted"> {insight.action.detail}</span>}
        </div>
      ) : (
        <p className="si-planned">Önerilen adım yok.</p>
      )}
      <PlannedLine planned={insight.planned} />
      {insight.flags.length > 0 && (
        <ul className="si-flags" aria-label="Engeller ve dikkat noktaları">
          {insight.flags.map((f) => (
            <li key={f.key} title={f.reason}>
              {f.label}
            </li>
          ))}
        </ul>
      )}
      <p className="si-meta">
        Son anlamlı hareket: {activityText(insight)}
        {insight.readiness && (
          <>
            {' · '}Outreach: <strong>{insight.readiness.label}</strong> · <a href={mailHref(company.id)}>Hazırlığı aç</a>
          </>
        )}
      </p>
      <Reasons insight={insight} summary="Neden bu öncelikte?" />
    </section>
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

function CompanyDetail({ company, section, onSection: setSection }: { company: Company; section: SectionId; onSection: (s: SectionId) => void }) {
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
