import { useState } from 'react';
import { CheckCircle2, CircleHelp, ExternalLink, Mail, MinusCircle, Phone, PlusCircle, Users, XCircle } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { Drawer } from '../../../components/ui/Drawer';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Tabs, type TabItem } from '../../../components/ui/Tabs';
import { OpportunityScore } from '../../../components/sales/OpportunityScore';
import { formatLocation } from '../../../domain/locations';
import {
  CONFIDENCE_LABELS,
  CRITERIA_MATCH_LABELS,
  EVIDENCE_SOURCE_LABELS,
  SIGNAL_STATE_LABELS,
  VERIFICATION_STATUS_LABELS,
  type ContactHintKind,
  type ResearchEvidence,
  type ResearchRequest,
  type ResearchResult,
  type SignalOrigin,
  type SignalState,
} from '../../../domain/research';
import { SERVICES } from '../../../domain/services';
import { formatDateTime } from '../../../lib/date';
import { toExternalUrl } from '../../../lib/url';

type TabId = 'overview' | 'verification' | 'opportunities' | 'signals' | 'sources' | 'contact';

const STATE_ICON: Record<SignalState, typeof PlusCircle> = {
  positive: PlusCircle,
  neutral: MinusCircle,
  negative: XCircle,
  unknown: CircleHelp,
};

const ORIGIN_LABEL: Record<SignalOrigin, string> = {
  check: 'Ölçüm',
  analysis: 'Analiz',
  not_inspected: 'İncelenmedi',
};

const CONTACT_LABEL: Record<ContactHintKind, string> = {
  email: 'E-posta',
  phone: 'Telefon',
  whatsapp: 'WhatsApp',
  contact_page: 'İletişim sayfası',
  person: 'Kişi',
};

/** Inline source references like [w2] that link to the evidence URL. */
function EvidenceRefs({ ids, evidence }: { ids: string[]; evidence: ResearchEvidence[] }) {
  const items = ids.map((id) => evidence.find((e) => e.id === id)).filter((e): e is ResearchEvidence => !!e);
  if (!items.length) return null;
  return (
    <span className="evidence-refs">
      {items.map((e) => (
        <a key={e.id} className="evidence-ref" href={e.url} target="_blank" rel="noopener noreferrer" title={e.title}>
          [{e.id}]<span className="visually-hidden"> {e.title} (yeni sekmede açılır)</span>
        </a>
      ))}
    </span>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <li className={ok ? 'check-item check-item--ok' : 'check-item'}>
      <Icon size={16} aria-hidden="true" />
      <span>
        {label}: <strong>{ok ? 'Doğrulandı' : 'Doğrulanamadı'}</strong>
      </span>
    </li>
  );
}

const RECOMMENDATION_LABEL = { primary: 'Birincil Fırsat', secondary: 'İkincil Fırsat', none: null } as const;
const VERIFICATION_TONE: Record<string, BadgeTone> = { verified: 'success', partial: 'warning', unverified: 'neutral' };

export function ResultDetailDrawer({
  result,
  request,
  onClose,
}: {
  result: ResearchResult | null;
  request: ResearchRequest;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={result !== null}
      onClose={onClose}
      title={result?.companyName ?? 'Şirket'}
      header={
        result && (
          <div className="company-header">
            <p className="company-header__name" aria-hidden="true">
              {result.companyName}
            </p>
            <p className="company-header__meta">
              {result.website && (
                <a href={toExternalUrl(result.website)} target="_blank" rel="noopener noreferrer" className="link">
                  {result.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  <ExternalLink size={12} aria-hidden="true" />
                  <span className="visually-hidden"> (yeni sekmede açılır)</span>
                </a>
              )}
              <span>{[result.sector, formatLocation(result.city, result.country)].join(' · ')}</span>
            </p>
            <p className="result-detail__mode">
              {request.provider === 'fixture' ? (
                <Badge tone="warning">Test verisi (fixture)</Badge>
              ) : (
                <Badge>Gerçek Araştırma</Badge>
              )}
            </p>
          </div>
        )
      }
    >
      {result && <ResultDetail key={result.id} result={result} />}
    </Drawer>
  );
}

function ResultDetail({ result: r }: { result: ResearchResult }) {
  const [tab, setTab] = useState<TabId>('overview');
  const evidence = r.evidence ?? [];
  const opportunities = r.serviceOpportunities ?? [];
  const tabs: TabItem<TabId>[] = [
    { id: 'overview', label: 'Genel Bakış' },
    { id: 'verification', label: 'Doğrulama' },
    { id: 'opportunities', label: 'Fırsatlar', count: opportunities.length },
    { id: 'signals', label: 'Sinyaller' },
    { id: 'sources', label: 'Kaynaklar', count: evidence.length },
    { id: 'contact', label: 'İletişim', count: r.contactHints?.length ?? 0 },
  ];
  const analyzed = !!r.analysis;

  return (
    <Tabs
      items={tabs}
      active={tab}
      onChange={setTab}
      label="Araştırma detayı"
      renderPanel={(id) => {
        switch (id) {
          case 'overview':
            return (
              <div className="detail-section result-detail">
                {!analyzed && (
                  <p className="research-alert">
                    {r.researchStatus === 'existing'
                      ? 'Bu şirket zaten Potansiyel Müşteriler’de olduğu için ayrıntılı analiz yapılmadı. Aşağıda keşif bilgileri var.'
                      : r.analysisError ?? 'Bu şirket için analiz henüz tamamlanmadı.'}
                  </p>
                )}
                {r.analysis && <p className="result-detail__summary">{r.analysis.summary}</p>}
                {r.analysis?.warnings.map((w) => (
                  <p key={w} className="research-alert">
                    {w}
                  </p>
                ))}
                <dl className="detail-grid">
                  <div className="detail-grid__row">
                    <dt>Genel Fırsat Skoru</dt>
                    <dd>
                      <OpportunityScore score={r.opportunityScore} />
                    </dd>
                  </div>
                  <div className="detail-grid__row">
                    <dt>Doğrulama</dt>
                    <dd>
                      {r.verification ? (
                        <Badge tone={VERIFICATION_TONE[r.verification.status]}>{VERIFICATION_STATUS_LABELS[r.verification.status]}</Badge>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div className="detail-grid__row">
                    <dt>Profil uyumu</dt>
                    <dd>
                      {CRITERIA_MATCH_LABELS[r.analysis?.criteriaMatch ?? r.discovery?.profileFit ?? 'unknown']}
                      {r.analysis?.criteriaNotes && <span className="text-muted"> · {r.analysis.criteriaNotes}</span>}
                    </dd>
                  </div>
                  <div className="detail-grid__row">
                    <dt>Sektör uyumu (keşif)</dt>
                    <dd>{r.discovery?.sectorFit || '—'}</dd>
                  </div>
                </dl>
                {opportunities.some((o) => o.recommendation !== 'none') && (
                  <div className="recommendations">
                    {opportunities
                      .filter((o) => o.recommendation !== 'none')
                      .map((o) => (
                        <p key={o.service} className="recommendation">
                          <span className="recommendation__label">{RECOMMENDATION_LABEL[o.recommendation]}</span>
                          <span className="service-tag">{SERVICES[o.service].label}</span>
                          <strong>{o.score}</strong>
                          <span className="text-muted">{CONFIDENCE_LABELS[o.confidence]} analiz güveni</span>
                        </p>
                      ))}
                  </div>
                )}
                {r.analysis && r.analysis.exclusionChecks.length > 0 && (
                  <div>
                    <h3 className="detail-section__title">Hariç tutma kontrolleri</h3>
                    <ul className="plain-list">
                      {r.analysis.exclusionChecks.map((e) => (
                        <li key={e.exclusion}>
                          {e.exclusion}:{' '}
                          <strong>{e.status === 'violated' ? 'Eşleşiyor (hariç)' : e.status === 'satisfied' ? 'Uygun' : 'Doğrulanamadı'}</strong>{' '}
                          <EvidenceRefs ids={e.evidenceIds} evidence={evidence} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          case 'verification':
            return r.verification ? (
              <div className="detail-section">
                <p className="verification-head">
                  <Badge tone={VERIFICATION_TONE[r.verification.status]}>{VERIFICATION_STATUS_LABELS[r.verification.status]}</Badge>
                  <span>Doğrulama güveni: {CONFIDENCE_LABELS[r.verification.confidence]}</span>
                </p>
                <ul className="check-list">
                  <Check ok={r.verification.officialWebsiteVerified} label="Resmi website" />
                  <Check ok={r.verification.locationVerified} label="Lokasyon" />
                  <Check ok={r.verification.sectorVerified} label="Sektör" />
                </ul>
                <h3 className="detail-section__title">Doğrulananlar</h3>
                <ul className="plain-list">
                  {r.verification.verified.length ? r.verification.verified.map((t) => <li key={t}>{t}</li>) : <li className="text-muted">—</li>}
                </ul>
                <h3 className="detail-section__title">Doğrulanamayanlar</h3>
                <ul className="plain-list">
                  {r.verification.unverified.length ? r.verification.unverified.map((t) => <li key={t}>{t}</li>) : <li className="text-muted">—</li>}
                </ul>
                <p className="text-muted">
                  Dayanak: <EvidenceRefs ids={r.verification.evidenceIds} evidence={evidence} />
                </p>
                <p className="field__hint">Doğrulama, fırsat skorundan bağımsızdır. Yüksek fırsat düşük doğrulamayla birlikte olabilir.</p>
              </div>
            ) : (
              <div className="detail-section">
                <EmptyState icon={CircleHelp} title="Doğrulama yapılmadı" description="Bu şirket analiz edilmediği için doğrulama sonucu yok." />
              </div>
            );
          case 'opportunities':
            return opportunities.length ? (
              <div className="detail-section">
                <ul className="opportunity-list">
                  {opportunities.map((o) => {
                    const positives = o.signals.filter((s) => s.state === 'positive');
                    const unknowns = o.signals.filter((s) => s.state === 'unknown');
                    return (
                      <li key={o.service} className="opportunity">
                        <div className="opportunity__top">
                          <span className="opportunity__service">
                            {SERVICES[o.service].label}
                            {o.recommendation !== 'none' && (
                              <Badge tone={o.recommendation === 'primary' ? 'accent' : 'neutral'}>{RECOMMENDATION_LABEL[o.recommendation]}</Badge>
                            )}
                          </span>
                          <span className="opportunity__score">
                            <OpportunityScore score={o.score} />
                            <span className="text-muted">{CONFIDENCE_LABELS[o.confidence]} analiz güveni</span>
                          </span>
                        </div>
                        <p className="opportunity__reason">{o.reason}</p>
                        {positives.length > 0 && (
                          <div className="why">
                            <p className="why__title">Neden?</p>
                            <ul>
                              {positives.slice(0, 5).map((s) => (
                                <li key={s.key}>
                                  {s.reason} <EvidenceRefs ids={s.evidenceIds} evidence={evidence} />
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {unknowns.length > 0 && (
                          <div className="why why--unknown">
                            <p className="why__title">Bilinmeyen</p>
                            <ul>
                              {unknowns.map((s) => (
                                <li key={s.key}>{s.label}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="field__hint">
                  Skorlar, sinyallerin ağırlıklarından kod ile hesaplanır. Bilinmeyen sinyaller skoru değil güveni düşürür.
                </p>
              </div>
            ) : (
              <div className="detail-section">
                <EmptyState icon={CircleHelp} title="Fırsat analizi yok" description="Bu şirket için hizmet fırsatları analiz edilmedi." />
              </div>
            );
          case 'signals':
            return (
              <div className="detail-section">
                {opportunities.map((o) => (
                  <div key={o.service} className="signal-group">
                    <h3 className="detail-section__title">{SERVICES[o.service].label}</h3>
                    <ul className="signal-list">
                      {o.signals.map((s) => {
                        const Icon = STATE_ICON[s.state];
                        return (
                          <li key={s.key} className={`signal signal--${s.state}`}>
                            <Icon size={14} aria-hidden="true" />
                            <div>
                              <p className="signal__head">
                                <strong>{s.label}</strong> · {SIGNAL_STATE_LABELS[s.state]}
                                <span className="signal__origin">{ORIGIN_LABEL[s.origin]}</span>
                              </p>
                              <p className="signal__reason">
                                {s.reason} <EvidenceRefs ids={s.evidenceIds} evidence={evidence} />
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {r.technical?.inspected && (
                  <div className="signal-group">
                    <h3 className="detail-section__title">Ölçülen website bilgileri</h3>
                    <ul className="plain-list">
                      <li>HTTPS: {r.technical.https ? 'Evet' : 'Hayır'}</li>
                      <li>Mobil viewport: {r.technical.hasViewport ? 'Var' : 'Yok'}</li>
                      <li>Ana sayfa yanıt süresi: {r.technical.responseTimeMs} ms (tek ölçüm)</li>
                      <li>Form sayısı (incelenen sayfalar): {r.technical.formCount}</li>
                      <li>CTA sayısı (ana sayfa): {r.technical.ctaCount}</li>
                      <li>Yapılandırılmış veri: {r.technical.hasStructuredData ? 'Var' : 'Yok'}</li>
                      <li>İncelenen sayfalar: {r.technical.pagesInspected.length}</li>
                    </ul>
                    <p className="field__hint">Bu bilgiler HTML’den ölçülür; tam bir teknik denetim değildir.</p>
                  </div>
                )}
                {!opportunities.length && <EmptyState icon={CircleHelp} title="Sinyal yok" description="Bu şirket analiz edilmedi." />}
              </div>
            );
          case 'sources':
            return evidence.length ? (
              <div className="detail-section">
                <ul className="source-list">
                  {evidence.map((e) => (
                    <li key={e.id} className="source">
                      <p className="source__head">
                        <span className="source__id">{e.id}</span>
                        <Badge>{EVIDENCE_SOURCE_LABELS[e.sourceType]}</Badge>
                      </p>
                      <a className="link source__title" href={e.url} target="_blank" rel="noopener noreferrer">
                        {e.title}
                        <ExternalLink size={12} aria-hidden="true" />
                        <span className="visually-hidden"> (yeni sekmede açılır)</span>
                      </a>
                      <p className="source__url">{e.url}</p>
                      {e.claim && <p className="source__claim">{e.claim}</p>}
                      <p className="source__date">Erişim: {formatDateTime(new Date(e.retrievedAt))}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="detail-section">
                <EmptyState icon={CircleHelp} title="Kaynak yok" description="Bu şirket için kaydedilmiş kaynak bulunmuyor." />
              </div>
            );
          case 'contact':
            return r.contactHints?.length ? (
              <div className="detail-section">
                <p className="field__hint">Yalnızca şirketin herkese açık sayfalarında yayınlanan iş iletişim bilgileri. Tahmin edilmiş adres yoktur.</p>
                <ul className="contact-list">
                  {r.contactHints.map((h) => (
                    <li key={`${h.kind}-${h.value}`} className="contact">
                      <p className="contact__name">
                        {h.kind === 'email' ? <Mail size={14} aria-hidden="true" /> : h.kind === 'phone' ? <Phone size={14} aria-hidden="true" /> : null}{' '}
                        {CONTACT_LABEL[h.kind]}: {h.kind === 'contact_page' || h.kind === 'whatsapp' ? (
                          <a className="link" href={h.value} target="_blank" rel="noopener noreferrer">
                            {h.value}
                            <span className="visually-hidden"> (yeni sekmede açılır)</span>
                          </a>
                        ) : (
                          h.value
                        )}
                      </p>
                      {h.role && <p className="contact__role">{h.role}</p>}
                      <p className="contact__role">
                        Güven: {CONFIDENCE_LABELS[h.confidence]} · Kaynak: <EvidenceRefs ids={h.evidenceIds} evidence={evidence} />
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="detail-section">
                <EmptyState icon={Users} title="Herkese açık iletişim bilgisi bulunamadı" description="İletişim bilgisi tahmin edilmez; yalnızca yayınlanmış bilgiler gösterilir." />
              </div>
            );
        }
      }}
    />
  );
}
