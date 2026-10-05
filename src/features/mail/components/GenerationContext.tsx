import type { ReactNode } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { OpportunityScore } from '../../../components/sales/OpportunityScore';
import type { Company } from '../../../domain/company';
import type { MailContext } from '../../../domain/mail/context';
import { PERSONALIZATION_LABELS, type MailDraft } from '../../../domain/mail/draft';
import { CONFIDENCE_LABELS, EVIDENCE_SOURCE_LABELS, VERIFICATION_STATUS_LABELS, type ResearchResult } from '../../../domain/research';
import { SERVICES } from '../../../domain/services';
import { formatDateTime } from '../../../lib/date';
import { toExternalUrl } from '../../../lib/url';

const SOURCE_LABEL: Record<string, string> = {
  sector: 'sektöre özel profil',
  family: 'sektör ailesi profili',
  family_inferred: 'sektör ailesi profili (özel sektör)',
  generic: 'genel iş profili (sektör tanınmadı)',
  none: 'bu hizmet için sektör bilgisi yok; araştırma kanıtı esas alınır',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mail-context__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Right column. Shows why a draft looks the way it does, keeping the two sources apart:
 * Şirkete Özel Kanıtlar (observed about this company) and Sektörel Kullanım Alanları (general).
 * Before the first generation it previews what will be available.
 */
export function GenerationContext({
  company,
  draft,
  preview,
  research,
}: {
  company: Company;
  draft: MailDraft | undefined;
  preview: MailContext;
  research: ResearchResult | null;
}) {
  const sector = draft?.sectorContext;
  const notes = draft?.generationNotes;
  const service = draft?.service ?? preview.service;
  const personalization = notes?.personalization ?? preview.personalization;
  const reasons = notes?.personalizationReasons ?? preview.personalizationReasons;
  const usedIds = new Set(sector?.useCasesUsed.map((u) => u.id) ?? []);
  const useCases = sector?.useCasesAvailable ?? preview.sectorGuidance?.useCases.map(({ id, tr }) => ({ id, tr })) ?? [];
  const guidanceSource = sector?.source ?? preview.sectorGuidance?.source ?? 'none';
  const evidence = draft
    ? draft.evidenceRefs.map((e) => ({ ...e, used: true }))
    : preview.companyEvidence.items.map((e) => ({ ...e, used: false }));

  return (
    <aside className="card mail-context" aria-labelledby="mail-context-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="mail-context-title" className="card__title">
            Üretim Bağlamı
          </h2>
          <p className="card__subtitle">{draft ? 'Bu taslak neden böyle yazıldı' : 'Taslak hazırlanırken kullanılacak bilgiler'}</p>
        </div>
      </header>
      <div className="card__body">
        <dl className="mail-context__list">
          <Row label="Şirket">{company.name}</Row>
          <Row label="Sektör">{sector?.sectorLabel ?? preview.sector.label}</Row>
          <Row label="Sektör Ailesi">{(sector?.familyLabel ?? preview.sector.familyLabel) || <span className="text-subtle">Belirlenemedi</span>}</Row>
          <Row label="Hizmet">{SERVICES[service].label}</Row>
          <Row label="Fırsat Skoru">
            <OpportunityScore score={research?.opportunityScore ?? company.opportunityScore} />
          </Row>
          <Row label="Analiz Güveni">
            {preview.research.analysisConfidence ? CONFIDENCE_LABELS[preview.research.analysisConfidence] : <span className="text-subtle">Araştırma yok</span>}
          </Row>
          <Row label="Doğrulama">
            {preview.research.verificationStatus ? (
              <>
                {VERIFICATION_STATUS_LABELS[preview.research.verificationStatus]}
                {preview.research.verificationConfidence && (
                  <span className="text-muted"> · Doğrulama güveni: {CONFIDENCE_LABELS[preview.research.verificationConfidence]}</span>
                )}
              </>
            ) : (
              <span className="text-subtle">Araştırma yok</span>
            )}
          </Row>
          <Row label="Kişiselleştirme">
            <Badge tone={personalization === 'specific' ? 'success' : personalization === 'cautious' ? 'warning' : 'neutral'}>{PERSONALIZATION_LABELS[personalization]}</Badge>
          </Row>
        </dl>
        {reasons.length > 0 && (
          <ul className="mail-context__reasons">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}

        <section className="mail-context__section" aria-labelledby="mail-evidence-title">
          <h3 id="mail-evidence-title" className="mail-context__title">
            Şirkete Özel Kanıtlar
          </h3>
          <p className="mail-context__help">KITE araştırmasında bu şirket hakkında gözlemlenenler. Şirkete özel ifadeler yalnızca bunlara dayanır.</p>
          {evidence.length ? (
            <ul className="mail-evidence">
              {evidence.map((e) => (
                <li key={e.id} className="mail-evidence__item">
                  <a className="link mail-evidence__link" href={toExternalUrl(e.url)} target="_blank" rel="noopener noreferrer">
                    {e.title || e.url}
                    <span className="visually-hidden"> (yeni sekmede açılır)</span>
                  </a>
                  <Badge tone={e.inspected ? 'success' : 'neutral'}>{EVIDENCE_SOURCE_LABELS[e.sourceType]}</Badge>
                  {e.claim && <span className="mail-evidence__claim">{e.claim}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-subtle mail-context__none">
              {draft ? 'Bu taslakta şirkete özel kanıt kullanılmadı.' : preview.research.available ? 'Araştırmada kullanılabilir kanıt yok.' : 'Bu şirket için KITE araştırması yok.'}
            </p>
          )}
          {notes?.companyObservation && (
            <p className="mail-context__observation">
              <span className="mail-context__label">Kullanılan gözlem:</span> {notes.companyObservation}
            </p>
          )}
        </section>

        <section className="mail-context__section" aria-labelledby="mail-usecases-title">
          <h3 id="mail-usecases-title" className="mail-context__title">
            Sektörel Kullanım Alanları
          </h3>
          <p className="mail-context__help">
            Bu tür işletmeler için genel bilgi; şirket hakkında gözlem değildir. Kaynak: {SOURCE_LABEL[guidanceSource]}.
          </p>
          {useCases.length ? (
            <ul className="mail-usecases">
              {useCases.map((u) => (
                <li key={u.id} className={usedIds.has(u.id) ? 'mail-usecases__item mail-usecases__item--used' : 'mail-usecases__item'}>
                  {u.tr}
                  {usedIds.has(u.id) && <span className="mail-usecases__used">Mailde kullanıldı</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-subtle mail-context__none">Bu hizmet için sektörel kullanım alanı tanımlı değil.</p>
          )}
        </section>

        {notes && (
          <section className="mail-context__section" aria-labelledby="mail-generation-title">
            <h3 id="mail-generation-title" className="mail-context__title">
              Üretim Notları
            </h3>
            {notes.serviceReasoning && <p className="mail-context__text">{notes.serviceReasoning}</p>}
            <p className="mail-context__help">
              {notes.provider === 'fixture' ? 'Test sağlayıcı (fixture)' : `Anthropic${notes.model ? ` · ${notes.model}` : ''}`} · {formatDateTime(new Date(draft!.generatedAt))} · {notes.promptVersion}
            </p>
            {notes.warnings.length > 0 && (
              <ul className="mail-context__reasons">
                {notes.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
