// Mail & Takip: first contact drafts (Phase 5), Gmail sending + reply tracking (Phase 6) and follow
// ups (Phase 7). Drafts are generated server side, reviewed, edited and approved here. A mail is sent
// only when Berk explicitly confirms it; approval never sends, and follow ups are never sent on their own.
import { useEffect, useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import { readHashParams } from '../../app/useHashRoute';
import { EmptyState } from '../../components/ui/EmptyState';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { useMailDrafts } from '../../state/mail/MailDraftsProvider';
import { CompanyDraftList } from './components/CompanyDraftList';
import { DraftWorkspace } from './components/DraftWorkspace';
import { useMailStatus } from './useMailStatus';
import { MAIL_ROUTE } from './routes';
import { OutreachBar } from './components/OutreachBar';
import { useOutreach } from '../../state/outreach/OutreachProvider';
import { FollowUpQueue } from './components/FollowUpQueue';
import { BatchPrepare } from './components/BatchPrepare';
import { outreachPrepApi } from '../../api/outreachPrepApi';
import type { PreparationOverviewItem } from '../../domain/outreachPrep';

export function MailPage() {
  const { companies, loadState: companiesState, loadError: companiesError } = useCompanies();
  const { drafts, loadState: draftsState, loadError: draftsError } = useMailDrafts();
  const { loadState: outreachState, loadError: outreachError, sends } = useOutreach();
  const loadError = companiesState === 'error' ? companiesError : draftsState === 'error' ? draftsError : outreachState === 'error' ? outreachError : null;
  const status = useMailStatus();
  const [selectedId, setSelectedId] = useState<string | null>(() => readHashParams().get('company'));

  // The company id arrives once through the URL; drop it so a refresh does not re-apply it.
  useEffect(() => {
    if (readHashParams().has('company')) window.history.replaceState(null, '', MAIL_ROUTE);
  }, []);

  const selected = useMemo(() => companies.find((c) => c.id === selectedId) ?? null, [companies, selectedId]);

  // Phase 13 readiness of every company (computed by the server); refreshed when companies, drafts or sends change.
  const [overview, setOverview] = useState<{ items: PreparationOverviewItem[]; realGenerations: { today: number; limit: number } } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    outreachPrepApi
      .overview(controller.signal)
      .then(setOverview)
      .catch(() => undefined);
    return () => controller.abort();
  }, [companies, drafts, sends, tick]);
  const readiness = useMemo(() => new Map((overview?.items ?? []).map((i) => [i.companyId, i])), [overview]);
  const counts = useMemo(() => {
    const items = overview?.items ?? [];
    return {
      ready: items.filter((i) => i.readiness.state === 'ready').length,
      noContact: items.filter((i) => i.readiness.reasons.some((r) => r.code === 'no_contact' || r.code === 'contact_invalid')).length,
      drafts: items.filter((i) => i.readiness.progress === 'draft_approved').length,
      sent: items.filter((i) => i.readiness.progress === 'sent').length,
    };
  }, [overview]);

  return (
    <div className="page mail">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Mail &amp; Takip</h1>
          <p className="page-header__subtitle">
            İlk temas için hazırlık durumunu gör, kanıta dayalı taslak hazırla, düzenle ve onayla.
          </p>
        </div>
        <p className="mail__notice" role="note">
          Onaylanan bir taslak yalnızca alıcıyı seçip “Bu Maili Gönder” ile onayladığında Gmail üzerinden gönderilir. Takip mailleri otomatik gönderilmez: zamanı gelen takibin taslağını sen hazırlatır, onaylar ve gönderirsin.
        </p>
      </header>

      <OutreachBar />

      <FollowUpQueue selectedId={selected?.id ?? null} onSelect={setSelectedId} />

      {overview && (
        <p className="mail__counts" aria-label="Outreach hazırlık özeti">
          <span>
            <strong>{counts.ready}</strong> Hazır
          </span>
          <span>
            <strong>{counts.noContact}</strong> kişi eksik
          </span>
          <span>
            <strong>{counts.drafts}</strong> onaylı taslak
          </span>
          <span>
            <strong>{counts.sent}</strong> ilk temas gönderildi
          </span>
        </p>
      )}
      {overview && <BatchPrepare items={overview.items} realGenerations={overview.realGenerations} provider={status.state.kind === 'ready' ? status.state.provider : null} onDone={() => setTick((t) => t + 1)} />}

      {loadError && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          Kayıtlı veriler yüklenemedi: {loadError}
        </p>
      )}

      <div className="mail__grid">
        <CompanyDraftList companies={companies} drafts={drafts} selectedId={selected?.id ?? null} onSelect={setSelectedId} readiness={readiness} />
        {selected ? (
          <DraftWorkspace key={selected.id} company={selected} status={status} />
        ) : (
          <section className="card mail__empty" aria-label="Mail taslağı">
            <EmptyState
              icon={Mail}
              title="Bir şirket seç"
              description="Soldaki listeden bir şirket seç ya da Potansiyel Müşteriler'de “Mail Taslağı Hazırla”ya bas."
            />
          </section>
        )}
      </div>
    </div>
  );
}
