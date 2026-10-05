// Mail & Takip (Phase 5): first contact draft workspace. Drafts are generated server side,
// reviewed, edited and approved here. Nothing is sent and no company status changes.
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

export function MailPage() {
  const { companies } = useCompanies();
  const { drafts } = useMailDrafts();
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
          Bu aşamada mail gönderilmez. Onaylanan taslaklar sonraki aşamada gönderime hazır olur; şirketin satış durumu değişmez.
        </p>
      </header>

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
