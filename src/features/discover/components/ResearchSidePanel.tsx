import type { ReactNode } from 'react';
import { Compass, Loader2, Play } from 'lucide-react';
import type { ResearchMode } from '../../../domain/research';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { RESEARCH_GUIDANCE } from '../../../domain/researchGuidance';
import { SERVICES } from '../../../domain/services';
import { draftCountry, type ResearchDraft } from '../draft';
import { RESEARCH_FORM_ID } from './ResearchForm';
import { sectorLabel } from '../../../domain/sectorTaxonomy';

const dash = <span className="text-subtle">—</span>;

/** Live summary of the criteria plus the start button (submits the research form). */
interface ResearchPreviewProps {
  draft: ResearchDraft;
  mode: ResearchMode;
  /** Turkish reason the start button is disabled (real mode only). */
  blocker: string | null;
  running: boolean;
}

export function ResearchPreview({ draft, mode, blocker, running }: ResearchPreviewProps) {
  const country = draftCountry(draft);
  const rows: [string, ReactNode][] = [
    ['Hizmet', draft.service ? SERVICES[draft.service].label : dash],
    ['Sektör', draft.sector.trim() ? sectorLabel(draft.sector) : dash],
    ['Ülke', country || dash],
    ['Şehir', draft.city.trim() || (country ? <span className="text-muted">Tüm şehirler</span> : dash)],
    ['Şirket Sayısı', draft.companyCount.trim() || dash],
    ['Profil Kriterleri', draft.criteria.trim() || <span className="text-subtle">Yok</span>],
    ['Hariç Tutulanlar', draft.exclusions.trim() || <span className="text-subtle">Yok</span>],
  ];

  return (
    <Card
      title="Araştırma Özeti"
      action={mode === 'demo' ? <Badge tone="accent">Demo</Badge> : <Badge>Gerçek Araştırma</Badge>}
      className="research-preview"
    >
      <dl className="preview-list">
        {rows.map(([label, value]) => (
          <div key={label} className="preview-list__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="submit"
        form={RESEARCH_FORM_ID}
        className="button button--primary research-preview__cta"
        disabled={blocker !== null}
        aria-describedby={blocker ? 'research-start-blocker' : undefined}
      >
        {running ? <Loader2 size={16} aria-hidden="true" className="spin" /> : <Play size={16} aria-hidden="true" />}
        {running ? 'Araştırma sürüyor…' : 'Araştırmayı Başlat'}
      </button>
      {blocker && !running ? (
        <p id="research-start-blocker" className="research-preview__blocker" role="status">
          {blocker}
        </p>
      ) : (
        <p className="research-preview__note">
          {mode === 'demo'
            ? 'Demo modunda gerçek araştırma yapılmaz; kriterlerine göre kurgusal sonuçlar oluşturulur.'
            : 'Gerçek araştırma birkaç dakika sürebilir ve API kullanımı ücretlidir. Sonuçlar kaynaklarıyla gösterilir.'}
        </p>
      )}
    </Card>
  );
}

/** What research for the chosen service will prioritise. Explanatory only. */
export function ServiceGuidance({ draft }: { draft: ResearchDraft }) {
  if (!draft.service) {
    return (
      <Card title="Araştırma Odağı">
        <p className="guidance__empty">
          <Compass size={16} aria-hidden="true" />
          Hizmet seçtiğinde, araştırmanın hangi sinyallere öncelik vereceğini burada göreceksin.
        </p>
      </Card>
    );
  }
  const guidance = RESEARCH_GUIDANCE[draft.service];
  return (
    <Card title={`Araştırma Odağı · ${SERVICES[draft.service].label}`} subtitle={guidance.focus}>
      <ul className="guidance__list">
        {guidance.signals.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </Card>
  );
}
