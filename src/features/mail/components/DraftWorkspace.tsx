import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, CheckCircle2, Circle, History, Loader2, RefreshCw, Save } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Tabs } from '../../../components/ui/Tabs';
import { useToast } from '../../../components/ui/Toast';
import { DataApiError, errorMessage } from '../../../api/dataApi';
import { outreachPrepApi } from '../../../api/outreachPrepApi';
import { useSaveAction } from '../../../state/useSaveAction';
import type { Company } from '../../../domain/company';
import { MAIL_ERROR_MESSAGES } from '../../../domain/mail/api';
import { buildMailContext } from '../../../domain/mail/context';
import { defaultMailLanguage, MAIL_DRAFT_STATUS_LABELS, type MailDraft } from '../../../domain/mail/draft';
import { angleLabel, TONE_LABELS } from '../../../domain/outreachAngles';
import { sectionIntact, type GenerateMode, type PreparationDetail, type PreparationPatch } from '../../../domain/outreachPrep';
import { READINESS_LABELS, type ReadinessReason } from '../../../domain/outreachReadiness';
import { SERVICES } from '../../../domain/services';
import { formatDateTime } from '../../../lib/date';
import { useMailDrafts } from '../../../state/mail/MailDraftsProvider';
import { buildMailRequest, findResearchForCompany, suggestedServices } from '../../../state/mail/mailRequest';
import { useResearch } from '../../../state/research/ResearchProvider';
import type { MailStatus } from '../useMailStatus';
import { DRAFT_TONE } from './CompanyDraftList';
import { ClaimPreview } from './ClaimPreview';
import { GenerationContext } from './GenerationContext';
import { OutreachThreads } from './OutreachThread';
import { FollowUpPanel } from './FollowUpPanel';
import { PreparationPanel, READINESS_TONE } from './PreparationPanel';
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

type TabId = 'prep' | 'draft';
interface ActionError {
  message: string;
  problems: string[];
  reasons: ReadinessReason[];
}

function toActionError(e: unknown): ActionError {
  const reasons = e instanceof DataApiError && Array.isArray(e.details.reasons) ? (e.details.reasons as ReadinessReason[]) : [];
  return { message: errorMessage(e), problems: e instanceof DataApiError ? e.problems : [], reasons };
}

/**
 * Selected company in Mail & Takip: Hazırlık (readiness and preparation choices, Phase 13) and
 * Taslak (the editor, approval and the existing send panel). Generation goes through the server's
 * readiness gate; nothing here sends without Berk's explicit confirmation in the send panel.
 */
export function DraftWorkspace({ company, status }: { company: Company; status: MailStatus }) {
  const { draftFor, upsert } = useMailDrafts();
  const { sendsFor } = useOutreach();
  const draft = draftFor(company.id);
  const sendCount = sendsFor(company.id).length;
  const [tab, setTab] = useState<TabId>(draft ? 'draft' : 'prep');
  const [detail, setDetail] = useState<PreparationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const showToast = useToast();

  // Readiness is computed by the server from stored data: reload when the company, its draft or its sends change.
  useEffect(() => {
    const controller = new AbortController();
    outreachPrepApi
      .detail(company.id, controller.signal)
      .then((d) => {
        setDetail(d);
        setDetailError(null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setDetailError(errorMessage(e));
      });
    return () => controller.abort();
  }, [company.id, company.updatedAt, draft?.updatedAt, sendCount]);

  const apply = useCallback(
    (d: PreparationDetail) => {
      setDetail(d);
      if (d.draft) upsert(d.draft);
    },
    [upsert],
  );

  const onPatch = useCallback(
    async (patch: PreparationPatch) => {
      setError(null);
      try {
        apply(await outreachPrepApi.update(company.id, patch));
      } catch (e) {
        setError(toActionError(e));
      }
    },
    [company.id, apply],
  );

  const runGenerate = useCallback(
    async (options: { mode: GenerateMode; variants?: boolean; replaceEdits?: boolean }) => {
      setError(null);
      setBusy(true);
      try {
        const d = await outreachPrepApi.generate(company.id, options);
        apply(d);
        setTab('draft');
        showToast({ title: options.mode === 'full' ? 'Taslak hazırlandı' : 'Taslak güncellendi', description: `${company.name}: incelemeye hazır. Hiçbir mail gönderilmedi.` });
      } catch (e) {
        setError(toActionError(e));
      } finally {
        setBusy(false);
      }
    },
    [company.id, company.name, apply, showToast],
  );

  const onUseVariant = useCallback(
    async (variantId: string, replaceEdits: boolean) => {
      setError(null);
      setBusy(true);
      try {
        apply(await outreachPrepApi.useVariant(company.id, variantId, replaceEdits));
        showToast({ title: 'Alternatif kullanıldı', description: 'Önceki metin “Önceki sürümler” altında saklandı.' });
      } catch (e) {
        setError(toActionError(e));
      } finally {
        setBusy(false);
      }
    },
    [company.id, apply, showToast],
  );

  const provider = status.state.kind === 'ready' ? status.state.provider : null;
  const messages = error ? [...error.reasons.map((r) => r.message), ...error.problems] : [];
  const errorBox = error && (
    <div className="research-alert research-alert--error" role="alert">
      <p>{error.message}</p>
      {messages.length > 0 && (
        <ul className="mail-editor__problems">
          {messages.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Workspace
      key={draft ? `${draft.id}:${draft.generatedAt}:${draft.previousVersions.length}` : 'new'}
      company={company}
      draft={draft}
      status={status}
      detail={detail}
      tab={tab}
      setTab={setTab}
      busy={busy}
      errorBox={errorBox}
      prepPanel={
        detail ? (
          <PreparationPanel company={company} detail={detail} busy={busy || connectionBlocker(status) !== null} provider={provider} onPatch={onPatch} onGenerate={(o) => runGenerate({ mode: 'full', ...o })} />
        ) : (
          <p className="text-subtle">{detailError ?? 'Hazırlık durumu yükleniyor…'}</p>
        )
      }
      onRegenerate={runGenerate}
      onUseVariant={onUseVariant}
    />
  );
}

interface WorkspaceProps {
  company: Company;
  draft: MailDraft | undefined;
  status: MailStatus;
  detail: PreparationDetail | null;
  tab: TabId;
  setTab: (t: TabId) => void;
  busy: boolean;
  errorBox: ReactNode;
  prepPanel: ReactNode;
  onRegenerate: (options: { mode: GenerateMode; replaceEdits?: boolean }) => Promise<void>;
  onUseVariant: (variantId: string, replaceEdits: boolean) => Promise<void>;
}

function Workspace({ company, draft, status, detail, tab, setTab, busy, errorBox, prepPanel, onRegenerate, onUseVariant }: WorkspaceProps) {
  const { save, approve } = useMailDrafts();
  const { sendsFor } = useOutreach();
  const sentSend = draft ? blockingSend(sendsFor(company.id), draft.id) : undefined;
  const { resultsByRequest } = useResearch();
  const showToast = useToast();
  const research = useMemo(() => findResearchForCompany(company, resultsByRequest), [company, resultsByRequest]);

  const [subject, setSubject] = useState(draft?.selectedSubject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [confirm, setConfirm] = useState<{ kind: 'full' } | { kind: 'variant'; id: string } | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  const dirty = !!draft && (subject !== draft.selectedSubject || body !== draft.body);
  const blocker = connectionBlocker(status);
  const prep = detail?.preparation ?? null;
  const prepared = !!draft && !!prep && prep.draftId === draft.id && prep.sections.length > 0;
  const readiness = detail?.readiness ?? null;
  const canRegenerate = !busy && !dirty && blocker === null && readiness?.state === 'ready';

  // Drafts from the earlier (Phase 5) flow keep their original context panel.
  const preview = useMemo(
    () =>
      buildMailContext(
        buildMailRequest(company, research, { service: draft?.service ?? suggestedServices(company)[0] ?? 'crm', language: draft?.language ?? defaultMailLanguage(company.country), contactId: draft?.contactId ?? null }),
      ),
    [company, research, draft],
  );

  const sectionEdited = (key: 'opening' | 'cta') => {
    const s = prep?.sections.find((x) => x.key === key);
    return !draft || !s || !sectionIntact(s, draft.body);
  };

  const regenerate = (mode: GenerateMode) => {
    if (!draft) return;
    if (mode === 'full' && (draft.editedSinceGeneration || draft.status === 'approved')) return setConfirm({ kind: 'full' });
    void onRegenerate({ mode });
  };

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

  // "Gönderime Hazır" checklist (before the first contact is sent).
  const checklist =
    draft && !sentSend && readiness
      ? [
          { ok: readiness.state === 'ready', label: `Hazırlık: ${READINESS_LABELS[readiness.state]}` },
          { ok: !!readiness.contact, label: readiness.contact ? `Alıcı: ${readiness.contact.contact.email}` : 'Geçerli e-postası olan alıcı yok' },
          { ok: !prepared || prep!.claims.every((c) => body.includes(c.sentence)), label: 'Şirkete özel cümlelerin kaynağı var' },
          { ok: draft.status === 'approved' && !dirty, label: 'Taslak onaylandı' },
        ]
      : null;
  const missing = checklist?.filter((c) => !c.ok).length ?? 0;

  const editor = (
    <div className="mail-editor__body">
      {!draft ? (
        <p className="mail-editor__intro">Henüz taslak yok. Hazırlık sekmesinde eksikleri tamamlayıp “Taslak hazırla”ya bas.</p>
      ) : (
        <>
          <p className="mail-editor__hint">
            {prepared ? (
              <>
                {prep!.service ? SERVICES[prep!.service].label : ''} · {angleLabel(prep!.angleKey)} · {TONE_LABELS[prep!.tone]} ·{' '}
                <button type="button" className="link-button" onClick={() => setTab('prep')}>
                  Hazırlığı değiştir
                </button>
              </>
            ) : (
              <>Bu taslak önceki akışla hazırlandı. Kanıta dayalı yeniden yazmak için Hazırlık sekmesini kullan.</>
            )}
          </p>
          <div className="mail-editor__actions" role="group" aria-label="Yeniden yaz">
            <button type="button" className="button button--secondary button--sm" disabled={!canRegenerate} onClick={() => regenerate('full')}>
              {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Tümünü yeniden yaz
            </button>
            {prepared && (
              <>
                <button type="button" className="button button--ghost button--sm" disabled={!canRegenerate} onClick={() => regenerate('subject')}>
                  Yalnızca konu
                </button>
                <button type="button" className="button button--ghost button--sm" disabled={!canRegenerate || sectionEdited('opening')} title={sectionEdited('opening') ? 'Bu bölümü elle düzenledin' : undefined} onClick={() => regenerate('opening')}>
                  Yalnızca giriş
                </button>
                <button type="button" className="button button--ghost button--sm" disabled={!canRegenerate || sectionEdited('cta')} title={sectionEdited('cta') ? 'Bu bölümü elle düzenledin' : undefined} onClick={() => regenerate('cta')}>
                  Yalnızca kapanış
                </button>
              </>
            )}
            {status.state.kind === 'ready' && status.state.provider === 'fixture' && <Badge tone="warning">Test sağlayıcı (fixture)</Badge>}
          </div>
          {dirty && <p className="mail-editor__hint">Yeniden yazmadan önce değişikliklerini kaydet; kaydedilmemiş metin sunucuda yok.</p>}
          {readiness && readiness.state !== 'ready' && !sentSend && <p className="mail-editor__hint">Yeniden yazmak için şirketin Hazır olması gerekir ({READINESS_LABELS[readiness.state]}).</p>}
          {blocker && (
            <p className="research-alert" role="status">
              {blocker}
            </p>
          )}
          {tab === 'draft' && errorBox}

          {confirm && (
            <div className="mail-confirm" role="alertdialog" aria-labelledby="mail-confirm-title">
              <p id="mail-confirm-title" className="mail-confirm__title">
                {draft.editedSinceGeneration || dirty ? 'Taslakta senin düzenlemelerin var' : 'Bu taslak onaylanmıştı'}
              </p>
              <p>Mevcut konu ve metin “Önceki sürümler” altında saklanır; yeni metin onların yerine geçer{draft.status === 'approved' ? ' ve onay kaldırılır' : ''}.</p>
              <div className="mail-confirm__actions">
                <button
                  type="button"
                  className="button button--primary button--sm"
                  autoFocus
                  onClick={() => {
                    const c = confirm;
                    setConfirm(null);
                    if (c.kind === 'full') void onRegenerate({ mode: 'full', replaceEdits: true });
                    else void onUseVariant(c.id, true);
                  }}
                >
                  {draft.editedSinceGeneration || dirty ? 'Düzenlememin yerine yaz' : 'Yeniden yaz'}
                </button>
                <button type="button" className="button button--secondary button--sm" onClick={() => setConfirm(null)}>
                  Vazgeç
                </button>
              </div>
            </div>
          )}

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
          {checklist && (
            <div className="send-checklist" aria-label="Gönderim kontrol listesi">
              <p className="send-checklist__title">
                <Badge tone={missing ? 'warning' : 'success'}>{missing ? `${missing} eksik` : 'Gönderime Hazır'}</Badge>
              </p>
              <ul>
                {checklist.map((c) => (
                  <li key={c.label} className={c.ok ? 'send-checklist__ok' : 'send-checklist__todo'}>
                    {c.ok ? <CheckCircle2 size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />} {c.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sentSend?.status === 'sent' && (
            <p className="mail-editor__hint">Bu taslak gönderildi. Taslakta yapılan değişiklikler gönderilen maili değiştirmez; takip mailleri yukarıdaki Takip Planı'ndan hazırlanır.</p>
          )}
          <SendPanel company={company} draft={draft} dirty={dirty} readinessBlocker={!sentSend && readiness ? (readiness.reasons.find((x) => x.group === 'blocked')?.message ?? null) : null} />
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
      )}
    </div>
  );

  return (
    <>
      <div className="mail__main">
        <FollowUpPanel company={company} />
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
            <div className="card__action mail-editor__badges">
              {readiness && <Badge tone={READINESS_TONE[readiness.state]}>{READINESS_LABELS[readiness.state]}</Badge>}
              {draft && <Badge tone={DRAFT_TONE[draft.status]}>{MAIL_DRAFT_STATUS_LABELS[draft.status]}</Badge>}
            </div>
          </header>
          <div className="card__body">
            <Tabs
              items={[
                { id: 'prep', label: 'Hazırlık' },
                { id: 'draft', label: 'Taslak' },
              ]}
              active={tab}
              onChange={setTab}
              label="Outreach hazırlığı ve taslak"
              renderPanel={(id) =>
                id === 'prep' ? (
                  <>
                    {prepPanel}
                    {tab === 'prep' && errorBox}
                  </>
                ) : (
                  editor
                )
              }
            />
          </div>
        </section>
      </div>
      {prepared && detail ? (
        <ClaimPreview
          detail={detail}
          body={body}
          busy={busy}
          onUseVariant={(id) => {
            if (draft!.editedSinceGeneration || dirty) return setConfirm({ kind: 'variant', id });
            void onUseVariant(id, false);
          }}
        />
      ) : (
        <GenerationContext company={company} draft={draft} preview={preview} research={research} />
      )}
    </>
  );
}
