import { useEffect, useState } from 'react';
import { Telescope } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { useResearch } from '../../state/research/ResearchProvider';
import { ResearchForm } from './components/ResearchForm';
import { ResearchPreview, ServiceGuidance } from './components/ResearchSidePanel';
import { ResearchResults } from './components/ResearchResults';
import { ResearchHistory } from './components/ResearchHistory';
import { EMPTY_DRAFT, applyPrefill, toCriteria, validateDraft, type DraftErrors, type ResearchDraft } from './draft';
import { clearPrefillFromUrl, readPrefill } from './prefill';

const FIELD_ORDER = ['service', 'sector', 'country', 'companyCount'] as const;
const FIELD_IDS: Record<(typeof FIELD_ORDER)[number], string> = {
  service: 'research-service',
  sector: 'research-sector',
  country: 'research-country',
  companyCount: 'research-count',
};

export function DiscoverPage() {
  const { companies } = useCompanies();
  const { requests, resultsByRequest, startResearch } = useResearch();
  const showToast = useToast();

  // Values handed over from Ana Sayfa's quick research arrive in the URL hash.
  const [draft, setDraft] = useState<ResearchDraft>(() => {
    const prefill = readPrefill();
    return prefill ? applyPrefill(EMPTY_DRAFT, prefill) : EMPTY_DRAFT;
  });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);

  useEffect(() => {
    if (readPrefill()) clearPrefillFromUrl();
  }, []);

  const active = requests.find((q) => q.id === activeId) ?? requests[0] ?? null;

  const updateDraft = (next: ResearchDraft) => {
    setDraft(next);
    // Clear errors for fields the user has fixed, without showing new ones until submit.
    if (Object.keys(errors).length) {
      const current = validateDraft(next);
      setErrors((e) => Object.fromEntries(Object.keys(e).filter((k) => k in current).map((k) => [k, current[k as keyof DraftErrors]])));
    }
  };

  const start = () => {
    const found = validateDraft(draft);
    setErrors(found);
    const first = FIELD_ORDER.find((k) => found[k]);
    if (first) {
      const custom = first === 'country' && document.getElementById('research-country-custom');
      (custom || document.getElementById(FIELD_IDS[first]))?.focus();
      return;
    }
    const request = startResearch(toCriteria(draft));
    setActiveId(request.id);
    setFocusKey((k) => k + 1);
    showToast({
      title: 'Demo araştırma oluşturuldu',
      description: `${request.name}: ${request.resultCount} demo sonuç hazır. Gerçek araştırma henüz yapılmıyor.`,
    });
  };

  const openRequest = (id: string) => {
    setActiveId(id);
    setFocusKey((k) => k + 1);
  };

  return (
    <div className="page discover">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Yeni Müşteri Bul</h1>
          <p className="page-header__subtitle">
            KITE için uygun şirketleri kriterlerine göre araştır ve satış havuzuna ekle.
          </p>
        </div>
      </header>

      <div className="discover__grid">
        <ResearchForm
          draft={draft}
          errors={errors}
          onChange={updateDraft}
          onPreset={(p) => {
            updateDraft(applyPrefill(draft, p));
            document.getElementById('research-service')?.focus();
          }}
          onSubmit={start}
        />
        <div className="discover__side">
          <ResearchPreview draft={draft} />
          <ServiceGuidance draft={draft} />
        </div>
      </div>

      {active ? (
        <ResearchResults
          key={active.id}
          request={active}
          results={resultsByRequest[active.id] ?? []}
          companies={companies}
          focusKey={focusKey}
        />
      ) : (
        <section className="card" aria-label="Araştırma sonuçları">
          <EmptyState
            icon={Telescope}
            title="Henüz sonuç yok"
            description="Kriterleri doldurup “Araştırmayı Başlat”a bastığında sonuçlar burada görünecek."
          />
        </section>
      )}

      <ResearchHistory
        requests={requests}
        resultsByRequest={resultsByRequest}
        activeId={active?.id ?? null}
        onOpen={openRequest}
      />
    </div>
  );
}
