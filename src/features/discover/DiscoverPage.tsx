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
import { ResearchModeSelector } from './components/ResearchModeSelector';
import { EMPTY_DRAFT, MAX_COMPANY_COUNT, applyPrefill, toCriteria, validateDraft, type DraftErrors, type ResearchDraft } from './draft';
import { clearPrefillFromUrl, readPrefill } from './prefill';
import { useResearchStatus } from './useResearchStatus';
import type { ResearchMode } from '../../domain/research';
import { RESEARCH_ERROR_MESSAGES } from '../../domain/researchApi';

const FIELD_ORDER = ['service', 'sector', 'country', 'companyCount'] as const;
const FIELD_IDS: Record<(typeof FIELD_ORDER)[number], string> = {
  service: 'research-service',
  sector: 'research-sector',
  country: 'research-country',
  companyCount: 'research-count',
};

export function DiscoverPage() {
  const { companies } = useCompanies();
  const { requests, resultsByRequest, startResearch, startRealResearch, runningRequestId, loadState, loadError, persistError } = useResearch();
  const [mode, setMode] = useState<ResearchMode>('demo');
  const { state: connection, refresh: refreshConnection } = useResearchStatus(mode === 'real');
  const maxCount = mode === 'real' && connection.kind === 'ready' ? connection.maxCompanies : MAX_COMPANY_COUNT;
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
      const current = validateDraft(next, maxCount);
      setErrors((e) => Object.fromEntries(Object.keys(e).filter((k) => k in current).map((k) => [k, current[k as keyof DraftErrors]])));
    }
  };

  // Real mode needs a ready server and no other real job running.
  const realBlocker =
    mode !== 'real'
      ? null
      : runningRequestId
        ? 'Bir gerçek araştırma zaten sürüyor.'
        : connection.kind === 'ready'
          ? null
          : connection.kind === 'not_configured'
            ? RESEARCH_ERROR_MESSAGES.not_configured
            : connection.kind === 'unreachable'
              ? RESEARCH_ERROR_MESSAGES.server_unreachable
              : 'Araştırma sunucusu kontrol ediliyor…';

  const start = () => {
    if (realBlocker) return;
    const found = validateDraft(draft, maxCount);
    setErrors(found);
    const first = FIELD_ORDER.find((k) => found[k]);
    if (first) {
      const custom = first === 'country' && document.getElementById('research-country-custom');
      (custom || document.getElementById(FIELD_IDS[first]))?.focus();
      return;
    }
    if (mode === 'real' && connection.kind === 'ready') {
      const request = startRealResearch(toCriteria(draft), connection.provider);
      if (!request) return;
      setActiveId(request.id);
      setFocusKey((k) => k + 1);
      showToast({
        title: 'Gerçek araştırma başladı',
        description: `${request.name}: şirketler aranıyor. Bu işlem birkaç dakika sürebilir.`,
      });
      return;
    }
    const request = startResearch(toCriteria(draft));
    setActiveId(request.id);
    setFocusKey((k) => k + 1);
    showToast({
      title: 'Demo araştırma oluşturuldu',
      description: `${request.name}: ${request.resultCount} demo sonuç hazır. Bu sonuçlar kurgusaldır.`,
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

      {(loadState === 'error' || persistError) && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          {persistError ?? `Araştırma geçmişi yüklenemedi: ${loadError}`}
        </p>
      )}

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
          modeSelector={
            <ResearchModeSelector
              mode={mode}
              onChange={(m) => {
                setMode(m);
                setErrors({});
              }}
              connection={connection}
              running={runningRequestId !== null}
              onRetryConnection={refreshConnection}
            />
          }
        />
        <div className="discover__side">
          <ResearchPreview draft={draft} mode={mode} blocker={realBlocker} running={mode === 'real' && runningRequestId !== null} />
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
