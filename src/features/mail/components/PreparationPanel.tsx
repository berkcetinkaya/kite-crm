// Hazırlık (Phase 13): readiness with its reasons, and the choices code uses for a draft (recipient,
// service, angle and its evidence, tone, CTA, language, manual facts, "Farklı şirket"). Changes are
// saved on the server immediately. "Taslak hazırla" works only when the server says Hazır; it never
// approves, sends or plans a follow up.
import { useState } from 'react';
import { AlertTriangle, Loader2, MailPlus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import type { Company } from '../../../domain/company';
import { MAIL_LANGUAGE_LABELS, type MailLanguage } from '../../../domain/mail/draft';
import {
  CTA_LABELS,
  EVIDENCE_KIND_LABELS,
  GENERAL_INTRO,
  GENERAL_INTRO_LABEL,
  MAX_MANUAL_FACTS,
  OUTREACH_TONES,
  TONE_LABELS,
  type CtaKey,
  type ManualFact,
  type OutreachTone,
} from '../../../domain/outreachAngles';
import type { PreparationDetail, PreparationPatch } from '../../../domain/outreachPrep';
import { PROGRESS_LABELS, READINESS_LABELS, type ReadinessState } from '../../../domain/outreachReadiness';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../../domain/services';
import { toExternalUrl } from '../../../lib/url';
import { ManualEmailForm } from '../../prospects/detail/ManualEmailForm';

export const READINESS_TONE: Record<ReadinessState, BadgeTone> = { ready: 'success', missing: 'warning', review: 'info', blocked: 'danger' };

interface Props {
  company: Company;
  detail: PreparationDetail;
  busy: boolean;
  provider: 'anthropic' | 'fixture' | null;
  onPatch: (patch: PreparationPatch) => Promise<void>;
  onGenerate: (options: { variants: boolean; replaceEdits: boolean }) => Promise<void>;
}

export function PreparationPanel({ company, detail, busy, provider, onPatch, onGenerate }: Props) {
  const r = detail.readiness;
  const prep = detail.preparation;
  const draft = detail.draft;
  const [variants, setVariants] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [factText, setFactText] = useState('');
  const [addingEmail, setAddingEmail] = useState(false);
  const blocked = r.state === 'blocked';
  const facts: ManualFact[] = prep?.manualFacts ?? [];
  const chosenAngle = prep?.angleKey ?? '';
  const services = [...new Set([...company.opportunities.map((o) => o.service), ...SERVICE_KEYS])];

  const generate = () => {
    if (draft?.editedSinceGeneration) return setConfirming(true);
    void onGenerate({ variants, replaceEdits: false });
  };

  return (
    <div className="prep">
      <div className="prep__status">
        <Badge tone={READINESS_TONE[r.state]}>{READINESS_LABELS[r.state]}</Badge>
        {r.progress !== 'none' && <span className="prep__progress">{PROGRESS_LABELS[r.progress]}</span>}
      </div>
      {r.reasons.length > 0 ? (
        <ul className="prep__reasons" aria-label="Hazırlık durumu nedenleri">
          {r.reasons.map((x, i) => (
            <li key={`${x.code}-${i}`} className={`prep__reason prep__reason--${x.group}`}>
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{x.message}</span>
              {(x.code === 'no_contact' || x.code === 'contact_invalid') && !addingEmail && (
                <button type="button" className="button button--secondary button--sm prep__add-email" onClick={() => setAddingEmail(true)}>
                  <MailPlus size={14} aria-hidden="true" /> E-posta ekle
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="prep__ok">{r.general ? 'Engel yok: açıkça seçilen Genel tanıtım taslağı hazırlanabilir (şirkete özel gözlem içermez).' : 'Engel yok: bu şirket için kanıta dayalı bir ilk temas taslağı hazırlanabilir.'}</p>
      )}

      {addingEmail && (
        <ManualEmailForm
          company={company}
          idPrefix="prep-email"
          onDone={(contact) => {
            setAddingEmail(false);
            // A recipient chosen earlier that has no valid address any more is replaced by the new one;
            // otherwise the automatic choice picks it up.
            if (contact && prep?.contactId && prep.contactId !== contact.id) void onPatch({ contactId: contact.id });
          }}
        />
      )}

      <fieldset className="prep__form" disabled={blocked || busy}>
        <legend className="visually-hidden">Hazırlık seçimleri</legend>
        <label className="field">
          <span className="field__label">Alıcı</span>
          <select className="input" value={prep?.contactId ?? ''} onChange={(e) => void onPatch({ contactId: e.target.value || null })}>
            <option value="">{r.contacts[0] ? `Otomatik: ${r.contacts[0].contact.fullName} (${r.contacts[0].reason})` : 'Geçerli e-postası olan kişi yok'}</option>
            {r.contacts.map((c) => (
              <option key={c.contact.id} value={c.contact.id}>
                {c.contact.fullName}
                {c.contact.role ? ` · ${c.contact.role}` : ''} · {c.contact.email} ({c.reason})
              </option>
            ))}
          </select>
          {r.contact?.general && <span className="field__hint">Genel adrese yazılır; selamlama kişiye özel olmaz.</span>}
        </label>

        <label className="field">
          <span className="field__label">Hizmet</span>
          <select className="input" value={prep?.service ?? ''} onChange={(e) => void onPatch({ service: (e.target.value || null) as ServiceKey | null })}>
            <option value="">{r.service && !prep?.service ? `Otomatik: ${SERVICES[r.service].label} (kayıtlı fırsat)` : 'Seç'}</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {SERVICES[s].label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Açı</span>
          <select className="input" value={chosenAngle} onChange={(e) => void onPatch({ angleKey: e.target.value || null })}>
            <option value="">{r.angles[0] ? `Otomatik: ${r.angles[0].label} (en güçlü kanıt)` : 'Kanıta dayalı açı yok'}</option>
            {r.angles.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label} · güç {a.strength}
              </option>
            ))}
            <option value={GENERAL_INTRO}>{GENERAL_INTRO_LABEL} (şirkete özel gözlem yok)</option>
          </select>
          {r.general && <span className="field__hint">Genel tanıtım açıkça seçildi: şirket kimliği, sektör ve hizmet anlatılır; şirkete özel sorun ya da gözlem yazılmaz.</span>}
        </label>

        {r.angle && (
          <div className="prep__evidence">
            <p className="field__label">Bu açıyı destekleyen kanıt</p>
            <ul>
              {r.angle.evidence.map((e) => (
                <li key={e.signalKey}>
                  <Badge tone={e.kind === 'observed' ? 'success' : e.kind === 'inferred' ? 'warning' : 'neutral'}>{EVIDENCE_KIND_LABELS[e.kind]}</Badge> {e.label}
                  {e.url && (
                    <>
                      {' · '}
                      <a href={toExternalUrl(e.url)} target="_blank" rel="noreferrer noopener">
                        kaynak
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="prep__row">
          <label className="field">
            <span className="field__label">Ton</span>
            <select className="input" value={r.tone} onChange={(e) => void onPatch({ tone: e.target.value as OutreachTone })}>
              {OUTREACH_TONES.map((t) => (
                <option key={t} value={t}>
                  {TONE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Kapanış çağrısı</span>
            <select className="input" value={r.cta} onChange={(e) => void onPatch({ ctaKey: e.target.value as CtaKey })}>
              {r.ctas.map((c) => (
                <option key={c} value={c}>
                  {CTA_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Dil</span>
            <select className="input" value={prep?.language ?? ''} onChange={(e) => void onPatch({ language: (e.target.value || null) as MailLanguage | null })}>
              <option value="">Otomatik (ülkeye göre)</option>
              {(['tr', 'en'] as const).map((l) => (
                <option key={l} value={l}>
                  {MAIL_LANGUAGE_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="field__hint">Ton yalnızca üslubu değiştirir; kanıt, iddialar ve hazırlık durumu aynı kalır.</p>

        <div className="prep__facts">
          <p className="field__label">Manuel bilgiler (yalnızca senin yazdıkların, metinde "Manuel" kaynak olarak kullanılabilir)</p>
          {facts.length > 0 && (
            <ul>
              {facts.map((f) => (
                <li key={f.id}>
                  <span>{f.text}</span>
                  <button type="button" className="icon-button" aria-label="Bilgiyi kaldır" onClick={() => void onPatch({ manualFacts: facts.filter((x) => x.id !== f.id) })}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {facts.length < MAX_MANUAL_FACTS && (
            <div className="prep__fact-add">
              <input className="input" maxLength={300} placeholder="Örn. Görüşmede iki yeni şube açtıklarını söylediler." value={factText} onChange={(e) => setFactText(e.target.value)} aria-label="Manuel bilgi" />
              <button
                type="button"
                className="button button--secondary button--sm"
                disabled={!factText.trim()}
                onClick={() => {
                  void onPatch({ manualFacts: [...facts, { id: '', text: factText.trim() }] });
                  setFactText('');
                }}
              >
                <Plus size={14} aria-hidden="true" /> Ekle
              </button>
            </div>
          )}
        </div>

        {r.duplicates.length > 0 && (
          <div className="prep__dups">
            <p className="field__label">CRM'de benzer şirketler</p>
            <ul>
              {r.duplicates.map((d) => (
                <li key={d.key}>
                  <Badge tone={d.level === 'hard' ? 'danger' : 'warning'}>{d.level === 'hard' ? "CRM'de mevcut" : 'Muhtemel tekrar'}</Badge> {d.companyName} · {d.label}
                  {d.level === 'probable' && (
                    <label className="stage-move__check">
                      <input
                        type="checkbox"
                        checked={d.acknowledged}
                        onChange={(e) => {
                          const acks = new Set(prep?.duplicateAcks ?? []);
                          if (e.target.checked) acks.add(d.key);
                          else acks.delete(d.key);
                          void onPatch({ duplicateAcks: [...acks] });
                        }}
                      />
                      <span>Farklı şirket</span>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <div className="prep__actions">
        <label className="stage-move__check">
          <input type="checkbox" checked={variants} onChange={(e) => setVariants(e.target.checked)} disabled={busy} />
          <span>2 alternatif de hazırla (aynı istek, ek maliyet yok)</span>
        </label>
        <button type="button" className="button button--primary" disabled={busy || r.state !== 'ready'} onClick={generate}>
          {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
          {busy ? 'Hazırlanıyor…' : draft ? 'Tüm taslağı yeniden yaz' : 'Taslak hazırla'}
        </button>
        {provider === 'fixture' && <Badge tone="warning">Test sağlayıcı (fixture, ücretsiz)</Badge>}
        {provider === 'anthropic' && (
          <span className="text-subtle">
            Bugünkü gerçek üretim: {detail.realGenerations.today} / {detail.realGenerations.limit}
          </span>
        )}
      </div>
      <p className="field__hint">Taslak hazırlamak hiçbir maili göndermez, onaylamaz ve takip planı başlatmaz.</p>

      {confirming && (
        <div className="mail-confirm" role="alertdialog" aria-labelledby="prep-confirm-title">
          <p id="prep-confirm-title" className="mail-confirm__title">
            Taslakta senin düzenlemelerin var
          </p>
          <p>Yeniden yazarsan mevcut konu ve metin “Önceki sürümler” altında saklanır, yeni taslak onların yerine geçer.</p>
          <div className="mail-confirm__actions">
            <button
              type="button"
              className="button button--primary button--sm"
              onClick={() => {
                setConfirming(false);
                void onGenerate({ variants, replaceEdits: true });
              }}
              autoFocus
            >
              Düzenlememin yerine yaz
            </button>
            <button type="button" className="button button--secondary button--sm" onClick={() => setConfirming(false)}>
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
