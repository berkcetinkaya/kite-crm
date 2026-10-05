import { Badge } from '../../../components/ui/Badge';
import type { Company } from '../../../domain/company';
import { EVIDENCE_SOURCE_LABELS, isInspectedEvidence } from '../../../domain/research';
import { formatShortDate } from '../../../lib/date';
import { toExternalUrl } from '../../../lib/url';

/** "drmichael.example/about-us" */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

/**
 * Compact, read-only list of the sources a real research job used for this prospect. Shown only for
 * companies transferred from real research; demo and manually added companies have none.
 */
export function ResearchSourcesSection({ company }: { company: Company }) {
  const ref = company.researchRef;
  if (!ref || ref.mode !== 'real' || ref.sourceUrls.length === 0) return null;
  const sources = ref.sources ?? ref.sourceUrls.map((url) => ({ url, title: '', sourceType: null }));
  return (
    <section className="detail-section research-sources" aria-labelledby={`research-sources-${company.id}`}>
      <div className="detail-section__header">
        <h3 className="detail-section__title" id={`research-sources-${company.id}`}>
          Araştırma Kaynakları
        </h3>
      </div>
      <p className="research-sources__meta">
        {ref.requestName} · {formatShortDate(new Date(ref.researchedAt))}
      </p>
      <ul className="research-sources__list">
        {sources.map((s) => (
          <li key={s.url} className="research-sources__item">
            <a className="link research-sources__link" href={toExternalUrl(s.url)} target="_blank" rel="noopener noreferrer" title={s.title || undefined}>
              {displayUrl(s.url)}
              <span className="visually-hidden"> (yeni sekmede açılır)</span>
            </a>
            {s.sourceType && (
              <Badge tone={isInspectedEvidence({ sourceType: s.sourceType }) ? 'success' : 'neutral'}>{EVIDENCE_SOURCE_LABELS[s.sourceType]}</Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
