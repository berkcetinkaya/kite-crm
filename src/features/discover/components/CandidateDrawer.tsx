// Candidate detail (Phase 12): "Neden bu firma?". Observed / inferred / unknown stay apart; review
// decisions are reversible until the candidate is added to the CRM, after which it is read-only and
// the company card is authoritative.
import { useState } from 'react';
import { ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { errorMessage } from '../../../api/dataApi';
import { discoveryApi } from '../../../api/discoveryApi';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { availableAngles } from '../../../domain/outreachAngles';
import { isValidEmail } from '../../../lib/email';
import { mailHref } from '../../mail/routes';
import { useToast } from '../../../components/ui/Toast';
import { NO_SECRETS_WARNING } from '../../../domain/customers';
import {
  CONTACT_PROVENANCE_LABELS,
  CONVERTED_LABEL,
  DUPLICATE_LEVEL_LABELS,
  duplicateBadgeLabel,
  isGated,
  PRIORITY_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUSES,
  SIGNAL_KNOWLEDGE_LABELS,
  signalKnowledge,
  type CandidateContact,
  type CandidateView,
  type ReviewStatus,
  type SignalKnowledge,
} from '../../../domain/prospecting';
import { CONFIDENCE_LABELS } from '../../../domain/research';
import { SECTOR_LABELS } from '../../../domain/sectorTaxonomy';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../../domain/services';
import { formatLocation } from '../../../domain/locations';
import { toExternalUrl } from '../../../lib/url';
import { ResultDetail } from './ResultDetailDrawer';

export const PRIORITY_TONE: Record<CandidateView['priority']['level'], BadgeTone> = { high: 'success', medium: 'warning', low: 'neutral' };
export const CONFIDENCE_TONE: Record<CandidateView['confidence']['level'], BadgeTone> = { high: 'success', medium: 'info', low: 'neutral' };
export const REVIEW_TONE: Record<ReviewStatus, BadgeTone> = { unreviewed: 'neutral', fit: 'success', not_fit: 'danger' };

/** Observed / inferred / unknown facts for the three columns. */
function knowledgeColumns(c: CandidateView): Record<SignalKnowledge, string[]> {
  const out: Record<SignalKnowledge, string[]> = { observed: [], inferred: [], unknown: [] };
  const r = c.result;
  const t = r.technical;
  if (r.website === null) out.unknown.push('Resmi website yok veya bulunamadı.');
  if (t?.inspected) {
    if (t.https !== null) out.observed.push(t.https ? 'HTTPS kullanıyor' : 'HTTPS yok');
    if (t.hasViewport !== null) out.observed.push(t.hasViewport ? 'Mobil görünüm etiketi var' : 'Mobil görünüm etiketi yok');
    if (t.formCount !== null) out.observed.push(t.formCount > 0 ? `${t.formCount} form var` : 'Form yok');
    if (t.hasEcommerceSignal) out.observed.push('E-ticaret işaretleri var');
    if (t.hasBookingSignal) out.observed.push('Rezervasyon / randevu işaretleri var');
    if (t.languageVersions) out.observed.push(`${t.languageVersions} dil sürümü tanımlı`);
    if (t.copyrightYear) out.observed.push(`Telif satırı: © ${t.copyrightYear}`);
  } else if (r.website) out.unknown.push('Website incelenemedi.');
  const seen = new Set<string>();
  for (const o of r.serviceOpportunities ?? []) {
    for (const s of o.signals) {
      const k = signalKnowledge(s);
      const text = `${SERVICES[o.service].shortLabel}: ${s.label}${k === 'unknown' ? '' : ` — ${s.state === 'positive' ? 'fırsatı destekliyor' : s.state === 'negative' ? 'fırsatı zayıflatıyor' : 'nötr'}`}`;
      if (seen.has(text)) continue;
      seen.add(text);
      out[k].push(text);
    }
  }
  if (!r.companySize) out.unknown.push('Çalışan sayısı: bilinmiyor');
  out.unknown.push('Ciro: bilinmiyor (tahmin edilmez)');
  return out;
}

interface CandidateDrawerProps {
  candidate: CandidateView;
  onChanged: (next: CandidateView) => void;
  onOpenCompany: (companyId: string) => void;
}

export function CandidateDrawerBody({ candidate: c, onChanged, onOpenCompany }: CandidateDrawerProps) {
  const r = c.result;
  const showToast = useToast();
  const converted = !!c.convertedCompanyId;
  const [status, setStatus] = useState<ReviewStatus>(c.review.status);
  const [reason, setReason] = useState(c.review.rejectReason ?? '');
  const [notes, setNotes] = useState(c.review.notes);
  const [sector, setSector] = useState(c.review.sector ?? '');
  const [services, setServices] = useState<ServiceKey[]>(c.review.services ?? c.defaultServices);
  const [contacts, setContacts] = useState<CandidateContact[]>(c.review.contacts ?? c.defaultContacts);
  const [newContact, setNewContact] = useState({ fullName: '', role: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<string[] | null>(null);
  const columns = knowledgeColumns(c);

  const run = async (call: () => Promise<{ candidate: CandidateView }>, toast?: string) => {
    setBusy(true);
    setError(null);
    try {
      const out = await call();
      onChanged(out.candidate);
      if (toast) showToast({ title: toast, description: r.companyName });
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const saveReview = () =>
    run(
      () =>
        discoveryApi.review(r.id, {
          status,
          rejectReason: reason.trim() || null,
          notes,
          sector: sector.trim() || null,
          sectorId: null,
          services,
          contacts,
        }),
      'İnceleme kaydedildi',
    );

  const reresearch = async () => {
    if (!window.confirm('Bu aday yeniden araştırılsın mı? Sitesi tekrar incelenir ve analiz yenilenir (gerçek sağlayıcıda ücretli). İnceleme kararların korunur.')) return;
    setBusy(true);
    setError(null);
    try {
      const out = await discoveryApi.reresearch(r.id);
      onChanged(out.candidate);
      setChanges(out.changes);
      showToast({ title: 'Yeniden araştırıldı', description: out.changes.length ? `${out.changes.length} değişiklik` : 'Değişiklik yok' });
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const toggleService = (s: ServiceKey) => setServices((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));

  return (
    <article className="candidate" aria-label={`Aday: ${r.companyName}`}>
      <header className="candidate__head">
        <div className="candidate__badges">
          <Badge tone={PRIORITY_TONE[c.priority.level]}>{PRIORITY_LABELS[c.priority.level]}</Badge>
          <Badge tone={CONFIDENCE_TONE[c.confidence.level]}>Araştırma güveni: {CONFIDENCE_LABELS[c.confidence.level]}</Badge>
          {converted ? <Badge tone="success">{CONVERTED_LABEL}</Badge> : <Badge tone={REVIEW_TONE[c.review.status]}>{REVIEW_STATUS_LABELS[c.review.status]}</Badge>}
          {c.duplicates.level && <Badge tone={c.duplicates.level === 'hard' ? 'danger' : c.duplicates.level === 'probable' ? 'warning' : 'info'}>{duplicateBadgeLabel(c.duplicates)}</Badge>}
        </div>
        <p className="candidate__meta">
          {r.website ? (
            <a className="link" href={toExternalUrl(r.website)} target="_blank" rel="noopener noreferrer">
              {r.website} <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <span className="text-subtle">Website yok</span>
          )}{' '}
          · {formatLocation(r.city, r.country)} · {c.review.sector ?? r.sector}
        </p>
        {converted && (
          <p className="candidate__converted">
            Bu aday CRM'e eklendi{c.convertedCompanyName ? `: ${c.convertedCompanyName}` : ''}. Değişiklikler şirket kartından yapılır.{' '}
            <button type="button" className="link-button" onClick={() => onOpenCompany(c.convertedCompanyId!)}>
              Şirket kartını aç
            </button>
          </p>
        )}
      </header>

      <OutreachPreview candidate={c} services={services} contacts={contacts} status={status} />

      <section className="candidate__section" aria-labelledby={`why-${r.id}`}>
        <h3 id={`why-${r.id}`} className="candidate__title">
          Neden bu firma?
        </h3>
        {c.priority.supporting.length ? (
          <ul className="candidate__list candidate__list--plus">
            {c.priority.supporting.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="sales-hint">Önerilecek kadar güçlü, kanıtlı bir fırsat sinyali yok.</p>
        )}
        {c.priority.weakening.length > 0 && (
          <>
            <p className="candidate__subtitle">Zayıflatanlar</p>
            <ul className="candidate__list candidate__list--minus">
              {c.priority.weakening.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </>
        )}
        <p className="candidate__subtitle">Araştırma güveni: {CONFIDENCE_LABELS[c.confidence.level]}</p>
        <p className="sales-hint">{c.confidence.reasons.join(' ')}</p>
        <p className="sales-hint">İletişim kanalları: {c.channels.length ? c.channels.join(', ') : 'bulunamadı'}</p>
      </section>

      <section className="candidate__section knowledge" aria-label="Gözlenen, çıkarım ve bilinmeyen">
        {(['observed', 'inferred', 'unknown'] as const).map((k) => (
          <div key={k} className={`knowledge__col knowledge__col--${k}`}>
            <p className="candidate__subtitle">{SIGNAL_KNOWLEDGE_LABELS[k]}</p>
            {columns[k].length ? (
              <ul className="candidate__list">
                {columns[k].slice(0, 12).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="sales-hint">—</p>
            )}
          </div>
        ))}
        <p className="sales-hint knowledge__note">Gözlenen: KITE'ın sitede ölçtüğü bilgiler. Çıkarım: modelin kanıtlardan yorumu (kesin bilgi değildir). Bilinmiyor: incelenemeyen veya kanıtı olmayan konular.</p>
      </section>

      {c.duplicates.matches.length > 0 && (
        <section className="candidate__section" aria-label="Tekrar kontrolü">
          <h3 className="candidate__title">Tekrar kontrolü</h3>
          <ul className="dup-list">
            {c.duplicates.matches.map((m) => (
              <li key={`${m.key}-${m.kind}`} className={`dup-list__item dup-list__item--${m.level}`}>
                <Badge tone={m.level === 'hard' ? 'danger' : m.level === 'probable' ? 'warning' : 'info'}>{m.acknowledged ? 'Farklı şirket (onaylandı)' : DUPLICATE_LEVEL_LABELS[m.level]}</Badge>
                <span>{m.label}</span>
                {m.companyId && (
                  <button type="button" className="link-button" onClick={() => onOpenCompany(m.companyId!)}>
                    Şirket kartını aç
                  </button>
                )}
                {m.level === 'probable' && !converted && (
                  <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void run(() => discoveryApi.acknowledge(r.id, m.key, !m.acknowledged), m.acknowledged ? 'Onay geri alındı' : 'Farklı şirket olarak onaylandı')}>
                    {m.acknowledged ? 'Onayı geri al' : 'Farklı şirket'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {c.duplicates.blocksConversion && <p className="sales-hint sales-hint--warn">CRM'de zaten var; ikinci kayıt oluşturulmaz.</p>}
        </section>
      )}

      {!converted && (
        <section className="candidate__section" aria-label="İnceleme">
          <h3 className="candidate__title">İnceleme</h3>
          <div className="chip-row" role="radiogroup" aria-label="İnceleme kararı">
            {REVIEW_STATUSES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={status === s} className={status === s ? 'filter-chip filter-chip--on' : 'filter-chip'} onClick={() => setStatus(s)}>
                {REVIEW_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {status === 'not_fit' && (
            <label className="field">
              <span className="field__label">Uygun değil nedeni (zorunlu)</span>
              <input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ör. Zincir klinik, bütçe uyumsuz" />
            </label>
          )}
          <p className="candidate__subtitle">Hizmetler (CRM'de yalnızca işaretliler fırsat olur)</p>
          <div className="service-checks">
            {SERVICE_KEYS.map((s) => (
              <label key={s} className="stage-move__check">
                <input type="checkbox" checked={services.includes(s)} onChange={() => toggleService(s)} />
                <span>
                  {SERVICES[s].label}
                  {c.defaultServices.includes(s) && <span className="sales-hint"> · önerilen</span>}
                  {isGated(s, c.familyId) && <span className="sales-hint"> · bu sektörde otomatik önerilmez</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="sales-form__grid">
            <label className="field">
              <span className="field__label">Sektör (isteğe bağlı düzeltme)</span>
              <input className="input" list={`sectors-${r.id}`} maxLength={120} value={sector} placeholder={r.sector} onChange={(e) => setSector(e.target.value)} />
              <datalist id={`sectors-${r.id}`}>
                {SECTOR_LABELS.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="field">
            <span className="field__label">Not</span>
            <textarea className="input textarea" rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <p className="candidate__subtitle">İletişim kişileri</p>
          <ul className="contact-list">
            {contacts.map((ct, i) => (
              <li key={`${ct.fullName}-${i}`} className="contact-list__item">
                <span>
                  <strong>{ct.fullName}</strong>
                  {ct.role && ` · ${ct.role}`}
                  {ct.email && ` · ${ct.email}`}
                  {ct.phone && ` · ${ct.phone}`}
                </span>
                <Badge tone={ct.provenance === 'manual' ? 'neutral' : 'info'}>{CONTACT_PROVENANCE_LABELS[ct.provenance]}</Badge>
                <button type="button" className="button button--ghost button--sm" onClick={() => setContacts((l) => l.filter((_, j) => j !== i))}>
                  Çıkar
                </button>
              </li>
            ))}
            {contacts.length === 0 && <li className="sales-hint">Kişi yok. Araştırma kişi uydurmaz; biliyorsan elle ekle.</li>}
          </ul>
          <div className="contact-add">
            <input className="input" aria-label="Ad soyad" placeholder="Ad soyad" value={newContact.fullName} onChange={(e) => setNewContact({ ...newContact, fullName: e.target.value })} />
            <input className="input" aria-label="Görev" placeholder="Görev" value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} />
            <input className="input" aria-label="E-posta" placeholder="E-posta" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
            <input className="input" aria-label="Telefon" placeholder="Telefon" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
            <button
              type="button"
              className="button button--secondary button--sm"
              disabled={!newContact.fullName.trim()}
              onClick={() => {
                setContacts((l) => [...l, { fullName: newContact.fullName.trim(), role: newContact.role.trim(), email: newContact.email.trim() || null, phone: newContact.phone.trim() || null, provenance: 'manual', evidenceIds: [] }]);
                setNewContact({ fullName: '', role: '', email: '', phone: '' });
              }}
            >
              Kişi ekle (Manuel)
            </button>
          </div>
          <p className="sales-hint">
            <ShieldAlert size={12} aria-hidden="true" /> {NO_SECRETS_WARNING} Kişisel e-posta tahmin edilmez.
          </p>
          {error && (
            <p className="research-alert research-alert--error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="button button--primary button--sm" onClick={() => void saveReview()} disabled={busy}>
              İncelemeyi kaydet
            </button>
            <button type="button" className="button button--ghost button--sm" onClick={() => void reresearch()} disabled={busy}>
              <RefreshCw size={14} aria-hidden="true" /> Yeniden araştır
            </button>
          </div>
          {c.versionCount > 0 && <p className="sales-hint">Önceki araştırma sürümleri saklanıyor: {c.versionCount} (en fazla 3).</p>}
          {changes && (
            <div className="changes">
              <p className="candidate__subtitle">Değişenler</p>
              {changes.length ? (
                <ul className="candidate__list">
                  {changes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : (
                <p className="sales-hint">Yeni araştırmada değişiklik yok.</p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="candidate__section" aria-label="Kaynaklar ve ayrıntılı analiz">
        <h3 className="candidate__title">Kaynaklar ve ayrıntılı analiz</h3>
        <ResultDetail result={r} />
      </section>
    </article>
  );
}

/**
 * Phase 13: read-only outreach preview. Candidates never get drafts; this only shows what readiness
 * would look like after conversion (contact email, service, evidence-backed angle, review).
 */
function OutreachPreview({ candidate: c, services, contacts, status }: { candidate: CandidateView; services: ServiceKey[]; contacts: CandidateContact[]; status: ReviewStatus }) {
  if (c.convertedCompanyId) {
    return (
      <p className="candidate__outreach">
        Outreach hazırlığı Mail &amp; Takip'te yapılır: <a href={mailHref(c.convertedCompanyId)}>Hazırlığı aç</a>
      </p>
    );
  }
  const service = services[0] ?? null;
  const angle = service ? availableAngles(c.result, service)[0] ?? null : null;
  const missing = [
    !contacts.some((x) => isValidEmail(x.email)) && 'geçerli e-postalı kişi yok',
    !service && 'hizmet seçilmedi',
    service && !angle && 'kanıta dayalı açı yok (Genel tanıtım yalnızca açık seçimle)',
    status !== 'fit' && 'inceleme Uygun değil',
  ].filter(Boolean) as string[];
  return (
    <p className="candidate__outreach" aria-label="Outreach önizlemesi (salt okunur)">
      <strong>Outreach önizlemesi (salt okunur).</strong> Adaylar için taslak hazırlanmaz: outreach hazırlığı yalnızca aday CRM'e eklendikten sonra Mail &amp; Takip'te yapılır.
      {' '}CRM'e eklenince: {missing.length ? <>{missing.length} eksik ({missing.join(', ')})</> : <>hazırlık için engel görünmüyor{angle ? ` · açı: ${angle.label}` : ''}</>}.
    </p>
  );
}
