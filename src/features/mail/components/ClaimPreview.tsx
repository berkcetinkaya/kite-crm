// Right column for prepared drafts (Phase 13): "Bu cümle neye dayanıyor?". The draft preview marks
// every company-specific sentence from the claim map; selecting one shows its sources (Gözlenen,
// Arama kaynağı, Çıkarım, Manuel, Şirket, Sektör) and the evidence links. Also lists alternatives.
import { useMemo, useState } from 'react';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { CLAIM_SOURCE_LABELS, CTA_LABELS, TONE_LABELS, angleLabel, type ClaimSourceKind } from '../../../domain/outreachAngles';
import type { ClaimMapEntry, PreparationDetail } from '../../../domain/outreachPrep';
import { SERVICES } from '../../../domain/services';
import { formatDateTime } from '../../../lib/date';
import { toExternalUrl } from '../../../lib/url';

const KIND_TONE: Record<ClaimSourceKind, BadgeTone> = { observed: 'success', search: 'neutral', inferred: 'warning', company: 'info', manual: 'accent', sector: 'neutral' };

/** Splits the body into plain text and claim sentences (first occurrence of each). */
export function highlightClaims(body: string, claims: readonly ClaimMapEntry[]): { text: string; claim: number | null }[] {
  const marks = claims
    .map((c, i) => ({ i, at: body.indexOf(c.sentence), len: c.sentence.length }))
    .filter((m) => m.at >= 0 && m.len > 0)
    .sort((a, b) => a.at - b.at);
  const out: { text: string; claim: number | null }[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.at < pos) continue;
    if (m.at > pos) out.push({ text: body.slice(pos, m.at), claim: null });
    out.push({ text: body.slice(m.at, m.at + m.len), claim: m.i });
    pos = m.at + m.len;
  }
  if (pos < body.length) out.push({ text: body.slice(pos), claim: null });
  return out;
}

interface Props {
  detail: PreparationDetail;
  body: string;
  busy: boolean;
  onUseVariant: (variantId: string) => void;
}

export function ClaimPreview({ detail, body, busy, onUseVariant }: Props) {
  const prep = detail.preparation!;
  const [active, setActive] = useState<number | null>(null);
  const parts = useMemo(() => highlightClaims(body, prep.claims), [body, prep.claims]);
  const sources = new Map(prep.claimSources.map((s) => [s.id, s]));
  const evidence = new Map(detail.evidence.map((e) => [e.id, e]));
  const missing = prep.claims.filter((c) => !body.includes(c.sentence));

  return (
    <aside className="card mail-context claim-preview" aria-labelledby="claim-preview-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="claim-preview-title" className="card__title">
            Bu cümle neye dayanıyor?
          </h2>
          <p className="card__subtitle">İşaretli cümleler şirkete özel; her biri bir kaynağa bağlı.</p>
        </div>
      </header>
      <div className="card__body">
        <dl className="mail-context__list">
          <div className="mail-context__row">
            <dt>Hizmet · Açı</dt>
            <dd>
              {prep.service ? SERVICES[prep.service].label : '—'} · {angleLabel(prep.angleKey)}
            </dd>
          </div>
          <div className="mail-context__row">
            <dt>Ton · Kapanış</dt>
            <dd>
              {TONE_LABELS[prep.tone]} · {prep.ctaKey ? CTA_LABELS[prep.ctaKey] : '—'}
            </dd>
          </div>
          <div className="mail-context__row">
            <dt>Alıcı</dt>
            <dd>{prep.contactSnapshot ? `${prep.contactSnapshot.fullName} · ${prep.contactSnapshot.email}` : '—'}</dd>
          </div>
          {prep.generatedAt && (
            <div className="mail-context__row">
              <dt>Üretim</dt>
              <dd>
                {formatDateTime(new Date(prep.generatedAt))} · {prep.provider === 'fixture' ? 'test sağlayıcı' : 'Anthropic'} · {prep.promptVersion}
              </dd>
            </div>
          )}
        </dl>

        <div className="claim-preview__body" aria-label="Taslak önizleme">
          {parts.map((p, i) =>
            p.claim === null ? (
              <span key={i}>{p.text}</span>
            ) : (
              <mark key={i} className={active === p.claim ? 'claim-preview__mark claim-preview__mark--active' : 'claim-preview__mark'}>
                <button type="button" onClick={() => setActive(active === p.claim ? null : p.claim)} aria-expanded={active === p.claim}>
                  {p.text}
                </button>
              </mark>
            ),
          )}
        </div>

        {prep.claims.length === 0 ? (
          <p className="text-subtle">Bu taslakta şirkete özel bir iddia yok (genel tanıtım).</p>
        ) : (
          <ol className="claim-preview__claims">
            {prep.claims.map((c, i) => (
              <li key={i} className={active === i ? 'claim-preview__claim claim-preview__claim--active' : 'claim-preview__claim'}>
                <button type="button" className="link-button" onClick={() => setActive(active === i ? null : i)}>
                  “{c.sentence}”
                </button>
                {active === i && (
                  <ul className="claim-preview__sources">
                    {c.sourceIds.map((id) => {
                      const s = sources.get(id);
                      if (!s) return null;
                      return (
                        <li key={id}>
                          <Badge tone={KIND_TONE[s.kind]}>{CLAIM_SOURCE_LABELS[s.kind]}</Badge> <span className="text-muted">{s.text}</span>
                          {s.evidenceIds.map((eid) => {
                            const e = evidence.get(eid);
                            return e ? (
                              <a key={eid} className="claim-preview__link" href={toExternalUrl(e.url)} target="_blank" rel="noreferrer noopener">
                                {e.title || e.url}
                              </a>
                            ) : null;
                          })}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        {detail.draft?.generationNotes.warnings.length ? (
          <ul className="claim-preview__warnings">
            {detail.draft.generationNotes.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {missing.length > 0 && <p className="field__hint">{missing.length} kaynaklı cümle metinde artık yok (elle düzenlendi). Elle yazdığın cümleler senin sorumluluğunda; kaynak eşlemesi yalnızca üretilen metin içindir.</p>}

        {prep.variants.length > 0 && (
          <div className="claim-preview__variants">
            <p className="field__label">Alternatifler</p>
            {prep.variants.map((v) => (
              <details key={v.id} className="claim-preview__variant">
                <summary>{v.label.startsWith('Farklı ton') ? v.label : `${v.label} · ${TONE_LABELS[v.tone]}`}</summary>
                <p className="text-muted">{v.subjectOptions[0]}</p>
                <pre className="mail-versions__body">{v.body}</pre>
                <button type="button" className="button button--secondary button--sm" disabled={busy} onClick={() => onUseVariant(v.id)}>
                  Bunu kullan
                </button>
              </details>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
