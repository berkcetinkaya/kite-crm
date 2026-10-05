import { useMemo, useRef, useState } from 'react';
import { Check, History, Loader2, RefreshCw, Save, Sparkles } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import { DataApiError, errorMessage } from '../../../api/dataApi';
import { useSaveAction } from '../../../state/useSaveAction';
import { isGeneralContact, type Company } from '../../../domain/company';
import { MAIL_ERROR_MESSAGES } from '../../../domain/mail/api';
import { buildMailContext } from '../../../domain/mail/context';
import { defaultMailLanguage, MAIL_DRAFT_STATUS_LABELS, MAIL_LANGUAGE_LABELS, type MailDraft, type MailLanguage } from '../../../domain/mail/draft';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../../domain/services';
import { formatDateTime } from '../../../lib/date';
import { useMailDrafts } from '../../../state/mail/MailDraftsProvider';
import { buildMailRequest, findResearchForCompany, suggestedServices } from '../../../state/mail/mailRequest';
import { useResearch } from '../../../state/research/ResearchProvider';
import type { MailStatus } from '../useMailStatus';
import { DRAFT_TONE } from './CompanyDraftList';
import { GenerationContext } from './GenerationContext';
import { OutreachThreads } from './OutreachThread';
import { SendPanel } from './SendPanel';
import { blockingSend } from '../../../domain/outreach';
import { useOutreach } from '../../../state/outreach/OutreachProvider';

function connectionBlocker(status: MailStatus): string | null {
  switch (status.state.kind) {
    case 'ready':
      return null;
    case 'checking':
      return 'Taslak servisi kontrol ediliyor…';
    case 'not_configured':
      return MAIL_ERROR_MESSAGES.not_configured;
    case 'unreachable':
      return MAIL_ERROR_MESSAGES.server_unreachable;
  }
}

export function DraftWorkspace({ company, status }: { company: Company; status: MailStatus }) {
  const { draftFor } = useMailDrafts();
  const draft = draftFor(company.id);
  // The editor is keyed by the generation so a new generation loads fresh text, while Berk's
  // unsaved edits survive re-renders.
  return <Workspace key={draft ? `${draft.id}:${draft.generatedAt}` : 'new'} company={company} draft={draft} status={status} />;
}

function Workspace({ company, draft, status }: { company: Company; draft: MailDraft | undefined; status: MailStatus }) {
  const { generate, save, approve } = useMailDrafts();
  const { sendsFor } = useOutreach();
  const sentSend = draft ? blockingSend(sendsFor(company.id), draft.id) : undefined;
  const { resultsByRequest } = useResearch();
  const showToast = useToast();
  const research = useMemo(() => findResearchForCompany(company, resultsByRequest), [company, resultsByRequest]);

  const suggested = suggestedServices(company);
  const [service, setService] = useState<ServiceKey>(draft?.service ?? suggested[0] ?? 'crm');
  const [language, setLanguage] = useState<MailLanguage>(draft?.language ?? defaultMailLanguage(company.country));
  const [contactId, setContactId] = useState<string | null>(draft?.contactId ?? null);
  const [subject, setSubject] = useState(draft?.selectedSubject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const dirty = !!draft && (subject !== draft.selectedSubject || body !== draft.body);
  const hasManualEdits = !!draft && (dirty || draft.editedSinceGeneration);
  const blocker = connectionBlocker(status);
  const settingsChanged = !!draft && (service !== draft.service || language !== draft.language || contactId !== draft.contactId);

  // Preview of what generation will use (pure, same rules as the server).
  const preview = useMemo(
    () => buildMailContext(buildMailRequest(company, research, { service, language, contactId })),
    [company, research, service, language, contactId],
  );

  const run = async (preserve: boolean) => {
    setConfirming(false);
    setError(null);
    setBusy(true);
    controller.current = new AbortController();
    try {
      await generate(company.id, { service, language, contactId, preserve: preserve && draft ? { selectedSubject: subject, body } : null }, controller.current.signal);
      showToast({
        title: draft ? 'Taslak yeniden oluşturuldu' : 'Mail taslağı hazırlandı',
        description: preserve ? 'Önceki sürümün “Önceki sürümler” altında saklandı.' : `${company.name}: incelemeye hazır. Hiçbir mail gönderilmedi.`,
      });
    } catch (e) {
      if (!(e instanceof DataApiError && e.code === 'cancelled')) {
        setError({ message: errorMessage(e), problems: e instanceof DataApiError ? e.problems : [] });
      }
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = () => {
    if (!draft) return void run(false);
    if (hasManualEdits || draft.status === 'approved') return setConfirming(true);
    void run(false);
  };

  // Saving and approving are confirmed by the server before anything is shown as done.
  const { run: runSave, saving } = useSaveAction();

  const onSave = () => {
    if (!draft) return;
    const wasApproved = draft.status === 'approved' && dirty;
    void runSave(
      () => save(draft.id, { selectedSubject: subject.trim(), body }),
      () => showToast({ title: 'Taslak kaydedildi', description: wasApproved ? 'Onay kaldırıldı; tekrar onaylaman gerekiyor.' : company.name }),
    );
  };

  const onApprove = () => {
    if (!draft) return;
    void runSave(
      () => approve(draft.id, { selectedSubject: subject.trim(), body }),
      () => showToast({ title: 'Taslak onaylandı', description: 'Göndermek için alıcıyı seç ve “Gönder…”e bas. Onay hiçbir maili otomatik göndermez.' }),
    );
  };

  const people = company.contacts.filter((c) => !isGeneralContact(c));
  const serviceOrder = [...suggested, ...SERVICE_KEYS.filter((s) => !suggested.includes(s))];

  return (
    <>
      <div className="mail__main">
        <OutreachThreads companyId={company.id} />
        <section className="card mail-editor" aria-labelledby="mail-editor-title">
          <header className="card__header">
            <div className="card__heading">
              <h2 id="mail-editor-title" className="card__title">
                {company.name}
              </h2>
              <p className="card__subtitle">
                {draft ? `Son üretim: ${formatDateTime(new Date(draft.generatedAt))}` : 'Henüz taslak yok'}
                {draft?.approvedAt && ` · Onay: ${formatDateTime(new Date(draft.approvedAt))}`}
              </p>
            </div>
            {draft && (
              <div className="card__action">
                <Badge tone={DRAFT_TONE[draft.status]}>{MAIL_DRAFT_STATUS_LABELS[draft.status]}</Badge>
              </div>
            )}
          </header>
          <div className="card__body mail-editor__body">
            <div className="mail-editor__settings">
              <label className="field">
                <span className="field__label">Hizmet</span>
                <select id="mail-service" className="input" value={service} onChange={(e) => setService(e.target.value as ServiceKey)}>
                  {serviceOrder.map((s) => (
                    <option key={s} value={s}>
                      {SERVICES[s].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Dil</span>
                <select id="mail-language" className="input" value={language} onChange={(e) => setLanguage(e.target.value as MailLanguage)}>
                  {(['tr', 'en'] as const).map((l) => (
                    <option key={l} value={l}>
                      {MAIL_LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Kime</span>
                <select id="mail-contact" className="input" value={contactId ?? ''} onChange={(e) => setContactId(e.target.value || null)}>
                  <option value="">Genel (ekip)</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                      {p.role ? ` · ${p.role}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {suggested[0] && <p className="mail-editor__hint">Şirketin kayıtlı fırsatlarına göre önerilen hizmet: {SERVICES[suggested[0]].label}</p>}
            {settingsChanged && <p className="mail-editor__hint">Hizmet, dil veya kişi değişikliği yeniden oluşturunca uygulanır.</p>}

            <div className="mail-editor__actions">
              <button type="button" className="button button--primary" onClick={onGenerate} disabled={busy || blocker !== null}>
                {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : draft ? <RefreshCw size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                {busy ? 'Hazırlanıyor…' : draft ? 'Yeniden Oluştur' : 'Taslak Hazırla'}
              </button>
              {busy && (
                <button type="button" className="button button--ghost" onClick={() => controller.current?.abort()}>
                  Durdur
                </button>
              )}
              {status.state.kind === 'ready' && status.state.provider === 'fixture' && <Badge tone="warning">Test sağlayıcı (fixture)</Badge>}
            </div>
            {blocker && (
              <p className="research-alert" role="status">
                {blocker}{' '}
                {status.state.kind !== 'checking' && (
                  <button type="button" className="link-button" onClick={status.refresh}>
                    Tekrar dene
                  </button>
                )}
              </p>
            )}
            {error && (
              <div className="research-alert research-alert--error" role="alert">
                <p>{error.message}</p>
                {error.problems.length > 0 && (
                  <ul className="mail-editor__problems">
                    {error.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {confirming && (
              <div className="mail-confirm" role="alertdialog" aria-labelledby="mail-confirm-title" aria-describedby="mail-confirm-text">
                <p id="mail-confirm-title" className="mail-confirm__title">
                  {hasManualEdits ? 'Elle yaptığın değişiklikler var' : 'Bu taslak onaylanmıştı'}
                </p>
                <p id="mail-confirm-text">
                  Yeniden oluşturursan mevcut konu ve metin “Önceki sürümler” altında saklanır; yeni taslak onların yerine geçer
                  {draft?.status === 'approved' ? ' ve onayı kaldırılır' : ''}.
                </p>
                <div className="mail-confirm__actions">
                  <button type="button" className="button button--primary button--sm" onClick={() => void run(true)} autoFocus>
                    Sakla ve yeniden oluştur
                  </button>
                  <button type="button" className="button button--secondary button--sm" onClick={() => setConfirming(false)}>
                    Vazgeç
                  </button>
                </div>
              </div>
            )}

            {draft ? (
              <>
                <fieldset className="mail-subjects">
                  <legend className="field__label">Konu satırı önerileri</legend>
                  {draft.subjectOptions.map((s, i) => (
                    <label key={`${i}-${s}`} className="mail-subjects__option">
                      <input type="radio" name="mail-subject-option" checked={subject === s} onChange={() => setSubject(s)} />
                      <span>{s}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="field">
                  <span className="field__label">Konu</span>
                  <input id="mail-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </label>
                <label className="field">
                  <span className="field__label">Mail metni</span>
                  <textarea id="mail-body" className="input textarea mail-editor__textarea" value={body} onChange={(e) => setBody(e.target.value)} rows={16} />
                </label>
                <p className="mail-editor__meta">
                  {body.split(/\s+/).filter(Boolean).length} kelime
                  {dirty && <span className="mail-editor__dirty"> · Kaydedilmemiş değişiklikler</span>}
                  {!dirty && draft.editedSinceGeneration && <span> · Elle düzenlendi</span>}
                </p>
                <div className="mail-editor__actions">
                  <button type="button" className="button button--secondary" onClick={onSave} disabled={saving || !dirty || !subject.trim() || !body.trim()}>
                    <Save size={16} aria-hidden="true" />
                    Kaydet
                  </button>
                  <button type="button" className="button button--primary" onClick={onApprove} disabled={saving || !subject.trim() || !body.trim() || (draft.status === 'approved' && !dirty)}>
                    <Check size={16} aria-hidden="true" />
                    {draft.status === 'approved' && !dirty ? 'Onaylandı' : 'Onayla'}
                  </button>
                </div>
                {sentSend?.status === 'sent' && (
                  <p className="mail-editor__hint">Bu taslak gönderildi. Taslakta yapılan değişiklikler gönderilen maili değiştirmez; yeni bir takip maili sonraki aşamada eklenecek.</p>
                )}
                <SendPanel company={company} draft={draft} dirty={dirty} />
                {draft.previousVersions.length > 0 && (
                  <div className="mail-versions">
                    <button type="button" className="link-button" aria-expanded={showVersions} onClick={() => setShowVersions((v) => !v)}>
                      <History size={14} aria-hidden="true" /> Önceki sürümler ({draft.previousVersions.length})
                    </button>
                    {showVersions && (
                      <ol className="mail-versions__list">
                        {draft.previousVersions.map((v) => (
                          <li key={v.savedAt + v.subject}>
                            <p className="mail-versions__head">
                              <strong>{v.subject}</strong> · {formatDateTime(new Date(v.savedAt))}
                            </p>
                            <pre className="mail-versions__body">{v.body}</pre>
                            <button
                              type="button"
                              className="button button--ghost button--sm"
                              onClick={() => {
                                setSubject(v.subject);
                                setBody(v.body);
                              }}
                            >
                              Bu sürümü editöre al
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="mail-editor__intro">
                Taslak; şirket araştırması, seçilen hizmet ve sektör bilgisi kullanılarak hazırlanır. Sağdaki panel hangi bilgilerin kullanılacağını gösterir.
              </p>
            )}
          </div>
        </section>
      </div>
      <GenerationContext company={company} draft={draft} preview={preview} research={research} />
    </>
  );
}
