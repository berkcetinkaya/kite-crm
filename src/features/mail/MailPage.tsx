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

export function MailPage() {
  const { companies, loadState: companiesState, loadError: companiesError } = useCompanies();
  const { drafts, loadState: draftsState, loadError: draftsError } = useMailDrafts();
  const { loadState: outreachState, loadError: outreachError } = useOutreach();
  const loadError = companiesState === 'error' ? companiesError : draftsState === 'error' ? draftsError : outreachState === 'error' ? outreachError : null;
  const status = useMailStatus();
  const [selectedId, setSelectedId] = useState<string | null>(() => readHashParams().get('company'));

  // The company id arrives once through the URL; drop it so a refresh does not re-apply it.
  useEffect(() => {
    if (readHashParams().has('company')) window.history.replaceState(null, '', MAIL_ROUTE);
  }, []);

  const selected = useMemo(() => companies.find((c) => c.id === selectedId) ?? null, [companies, selectedId]);

  return (
    <div className="page mail">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Mail &amp; Takip</h1>
          <p className="page-header__subtitle">
            İlk temas maillerini şirket araştırmasına ve sektör bilgisine göre hazırla, düzenle ve onayla.
          </p>
        </div>
        <p className="mail__notice" role="note">
          Onaylanan bir taslak yalnızca alıcıyı seçip “Bu Maili Gönder” ile onayladığında Gmail üzerinden gönderilir. Takip mailleri otomatik gönderilmez: zamanı gelen takibin taslağını sen hazırlatır, onaylar ve gönderirsin.
        </p>
      </header>

      <OutreachBar />

      <FollowUpQueue selectedId={selected?.id ?? null} onSelect={setSelectedId} />

      {loadError && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          Kayıtlı veriler yüklenemedi: {loadError}
        </p>
      )}

      <div className="mail__grid">
        <CompanyDraftList companies={companies} drafts={drafts} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
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
