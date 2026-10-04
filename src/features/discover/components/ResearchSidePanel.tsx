import type { ReactNode } from 'react';
import { Compass, Play } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { RESEARCH_GUIDANCE } from '../../../domain/researchGuidance';
import { SERVICES } from '../../../domain/services';
import { draftCountry, type ResearchDraft } from '../draft';
import { RESEARCH_FORM_ID } from './ResearchForm';

const dash = <span className="text-subtle">—</span>;

/** Live summary of the criteria plus the start button (submits the research form). */
export function ResearchPreview({ draft }: { draft: ResearchDraft }) {
  const country = draftCountry(draft);
  const rows: [string, ReactNode][] = [
    ['Hizmet', draft.service ? SERVICES[draft.service].label : dash],
    ['Sektör', draft.sector.trim() || dash],
    ['Ülke', country || dash],
    ['Şehir', draft.city.trim() || (country ? <span className="text-muted">Tüm şehirler</span> : dash)],
    ['Şirket Sayısı', draft.companyCount.trim() || dash],
    ['Profil Kriterleri', draft.criteria.trim() || <span className="text-subtle">Yok</span>],
    ['Hariç Tutulanlar', draft.exclusions.trim() || <span className="text-subtle">Yok</span>],
  ];

  return (
    <Card title="Araştırma Özeti" action={<Badge tone="accent">Demo</Badge>} className="research-preview">
      <dl className="preview-list">
        {rows.map(([label, value]) => (
          <div key={label} className="preview-list__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <button type="submit" form={RESEARCH_FORM_ID} className="button button--primary research-preview__cta">
        <Play size={16} aria-hidden="true" />
        Araştırmayı Başlat
      </button>
      <p className="research-preview__note">
        Bu fazda gerçek araştırma yapılmaz; kriterlerine göre kurgusal demo sonuçlar oluşturulur.
      </p>
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
