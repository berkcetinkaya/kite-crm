// Follow up plan of one company (Phase 7), inside Mail & Takip. Every step is Berk's explicit action:
// the draft is generated only by "Takip Taslağını Hazırla", sent only after "Gönder…" and the final
// "Bu Takip Mailini Gönder". Right before sending, the server checks the Gmail conversation for a new
// reply; if there is one, nothing is sent and the remaining follow ups stop.
import { useRef, useState } from 'react';
import { CalendarClock, Check, CircleAlert, Loader2, Pause, Play, RefreshCw, Save, Send, ShieldCheck, SkipForward, Sparkles, Square } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import { DataApiError, errorMessage } from '../../../api/dataApi';
import { newIdempotencyKey } from '../../../api/outreachApi';
import type { Company } from '../../../domain/company';
import {
  currentStepOf,
  FOLLOW_UP_PAUSE_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  FOLLOW_UP_STEP_STATUS_LABELS,
  stepLabel,
  type FollowUpSequenceView,
  type FollowUpStep,
} from '../../../domain/followUp';
import { MAIL_DRAFT_STATUS_LABELS, type MailDraft } from '../../../domain/mail/draft';
import { MAX_FOLLOW_UP_WORDS } from '../../../domain/mail/followUpSafety';
import { formatDateTime, fromDateInputValue, toDateInputValue } from '../../../lib/date';
import { useFollowUps } from '../../../state/followUps/FollowUpsProvider';
import { useOutreach } from '../../../state/outreach/OutreachProvider';
import { DRAFT_TONE } from './CompanyDraftList';
import { FOLLOW_UP_TONE, shortDate, STEP_TONE } from '../followUpView';

type Problem = { message: string; problems: string[] };
const asProblem = (e: unknown): Problem => ({ message: errorMessage(e), problems: e instanceof DataApiError ? e.problems : [] });

export function FollowUpPanel({ company }: { company: Company }) {
  const { overview, sequenceFor, candidateFor, createPlan } = useFollowUps();
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!overview) return null;
  const seq = sequenceFor(company.id);
  const candidate = candidateFor(company.id);

  if (!seq) {
    if (!candidate) return null;
    const onCreate = async () => {
      setBusy(true);
      setError(null);
      try {
        await createPlan(company.id);
        showToast({ title: 'Takip planı oluşturuldu', description: 'Takip zamanı geldiğinde Takip Kuyruğu’nda görünür. Hiçbir mail gönderilmedi.' });
      } catch (e) {
        setError(errorMessage(e));
      }
      setBusy(false);
    };
    return (
      <section className="card fu-panel" aria-labelledby="fu-panel-title">
        <header className="card__header">
          <div className="card__heading">
            <h2 id="fu-panel-title" className="card__title">
              <CalendarClock size={16} aria-hidden="true" /> Takip Planı
            </h2>
            <p className="card__subtitle">İlk mail {shortDate(candidate.sentAt)} tarihinde gönderildi, henüz yanıt yok ve takip planı yok.</p>
          </div>
        </header>
        <div className="card__body fu-panel__body">
          <p className="fu-panel__hint">
            Plan oluşturulursa takip tarihleri gönderim tarihinden hesaplanır ({overview.settings.delays.slice(0, overview.settings.maxSteps).join(', ')} gün). Takip mailleri yine yalnızca senin onayınla gönderilir.
          </p>
          {!overview.settings.enabled && <p className="fu-panel__hint" role="status">Takip sistemi kapalı; plan oluşturmak için önce Ayarlar & Otomasyon’dan aç.</p>}
          {error && (
            <p className="research-alert research-alert--error" role="alert">
              {error}
            </p>
          )}
          <div className="mail-editor__actions">
            <button type="button" className="button button--secondary" onClick={() => void onCreate()} disabled={busy || !overview.settings.enabled}>
              {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <CalendarClock size={16} aria-hidden="true" />}
              Takip Planı Oluştur
            </button>
          </div>
        </div>
      </section>
    );
  }
  return <SequenceCard key={seq.id} seq={seq} />;
}

function SequenceCard({ seq }: { seq: FollowUpSequenceView }) {
  const { overview, draftFor, stop, resume } = useFollowUps();
  const showToast = useToast();
  const step = currentStepOf(seq);
  const draft = step ? draftFor(step.draftId) : undefined;
  const now = overview ? new Date(overview.now) : new Date();
  const finished = seq.status === 'completed_replied' || seq.status === 'completed_no_reply' || seq.status === 'stopped';
  const [stopping, setStopping] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, toast: { title: string; description?: string }) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      showToast(toast);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card fu-panel" aria-labelledby="fu-panel-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="fu-panel-title" className="card__title">
            <CalendarClock size={16} aria-hidden="true" /> Takip Planı
          </h2>
          <p className="card__subtitle">
            Alıcı: {seq.recipientNameSnapshot ? `${seq.recipientNameSnapshot} <${seq.recipientEmailSnapshot}>` : seq.recipientEmailSnapshot} · Son gönderim: {shortDate(seq.lastSentAt)}
          </p>
        </div>
        <div className="card__action">
          <Badge tone={FOLLOW_UP_TONE[seq.effectiveStatus]} dot>
            {FOLLOW_UP_STATUS_LABELS[seq.effectiveStatus]}
          </Badge>
        </div>
      </header>
      <div className="card__body fu-panel__body">
        <ol className="fu-steps" aria-label="Takip adımları">
          {seq.steps.map((s) => (
            <li key={s.id} className={s.id === step?.id ? 'fu-step fu-step--current' : 'fu-step'}>
              <span className="fu-step__name">{stepLabel(s.stepNumber)}</span>
              <Badge tone={STEP_TONE[s.status]}>{FOLLOW_UP_STEP_STATUS_LABELS[s.status]}</Badge>
              <span className="fu-step__meta">{stepMeta(s)}</span>
            </li>
          ))}
        </ol>

        {seq.status === 'paused' && seq.pauseReason && (
          <div className="fu-note" role="status">
            <p>
              <Pause size={14} aria-hidden="true" /> {FOLLOW_UP_PAUSE_LABELS[seq.pauseReason]}
            </p>
            <button type="button" className="button button--secondary button--sm" disabled={busy} onClick={() => void act(() => resume(seq.id), { title: 'Takip sürdürüldü' })}>
              <Play size={14} aria-hidden="true" /> Takibi Sürdür
            </button>
          </div>
        )}
        {seq.blockers.length > 0 && (
          <div className="mail-review" role="status">
            <p className="mail-review__title">
              <CircleAlert size={14} aria-hidden="true" /> Takip şu anda ilerletilemez
            </p>
            <ul className="fu-blockers">
              {seq.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        {finished && <p className="fu-panel__hint">{finishedText(seq)}</p>}

        {/* Keyed by step and generation: a new draft loads fresh text, unsaved edits survive re-renders. */}
        {step && !finished && <StepWork key={`${step.id}:${draft?.generatedAt ?? 'none'}`} seq={seq} step={step} draft={draft} now={now} />}

        {error && (
          <p className="research-alert research-alert--error" role="alert">
            {error}
          </p>
        )}

        {!finished && (
          <div className="fu-panel__footer">
            {stopping ? (
              <div className="mail-confirm" role="alertdialog" aria-labelledby="fu-stop-title">
                <p id="fu-stop-title" className="mail-confirm__title">
                  Takip durdurulsun mu?
                </p>
                <p>Kalan takip adımları iptal edilir. Hazırlanan taslaklar ve gönderilen mailler geçmişte kalır; şirketin satış durumu değişmez.</p>
                <label className="field">
                  <span className="field__label">Neden (isteğe bağlı)</span>
                  <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Örn. telefonda konuştuk" />
                </label>
                <div className="mail-confirm__actions">
                  <button
                    type="button"
                    className="button button--primary button--sm"
                    disabled={busy}
                    onClick={async () => {
                      if (await act(() => stop(seq.id, reason.trim() || null), { title: 'Takip durduruldu', description: 'Kalan takipler iptal edildi.' })) setStopping(false);
                    }}
                  >
                    Takibi Durdur
                  </button>
                  <button type="button" className="button button--secondary button--sm" onClick={() => setStopping(false)} disabled={busy}>
                    Vazgeç
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="button button--ghost button--sm" onClick={() => setStopping(true)}>
                <Square size={14} aria-hidden="true" /> Takibi Durdur
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function stepMeta(s: FollowUpStep): string {
  if (s.status === 'sent' && s.sentAt) return `Gönderildi: ${formatDateTime(new Date(s.sentAt))}`;
  if (s.status === 'skipped' && s.skippedAt) return `Atlandı: ${shortDate(s.skippedAt)}`;
  if (s.status === 'cancelled') return s.cancelReason === 'reply' ? 'Yanıt geldiği için iptal' : s.cancelReason === 'stopped' ? 'Takip durdurulduğu için iptal' : 'Satış durumu nedeniyle iptal';
  if (s.status === 'pending') return `Önceki adım gönderildikten ${s.delayDays} gün sonra`;
  if (!s.dueAt) return '';
  return `Takip tarihi: ${shortDate(s.dueAt)}${s.postponedAt && s.originalDueAt ? ` (ertelendi; ilk tarih ${shortDate(s.originalDueAt)})` : ''}`;
}

function finishedText(seq: FollowUpSequenceView): string {
  if (seq.status === 'completed_replied') return 'Yanıt geldiği için takip bitti. Kalan adımlar iptal edildi; yanıt aşağıdaki konuşmada.';
  if (seq.status === 'completed_no_reply') return 'Tüm takip adımları tamamlandı (yanıt gelmedi).';
  return `Takip durduruldu${seq.stoppedAt ? ` (${shortDate(seq.stoppedAt)})` : ''}${seq.stopReason ? `: ${seq.stopReason}` : '.'}`;
}

function StepWork({ seq, step, draft, now }: { seq: FollowUpSequenceView; step: FollowUpStep; draft: MailDraft | undefined; now: Date }) {
  const { prepare, save, approve, postpone, skip, send } = useFollowUps();
  const { gmail } = useOutreach();
  const showToast = useToast();
  const [body, setBody] = useState(draft?.body ?? '');
  const [busy, setBusy] = useState<null | 'prepare' | 'save' | 'approve' | 'postpone' | 'skip' | 'send'>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [postponing, setPostponing] = useState(false);
  const [newDate, setNewDate] = useState(() => toDateInputValue(new Date(now.getTime() + 3 * 86_400_000).toISOString()));
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const keyRef = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const active = seq.status === 'active';
  const blocked = seq.blockers.length > 0;
  const dirty = !!draft && body !== draft.body;
  const words = body.split(/\s+/).filter(Boolean).length;
  const canPrepare = active && !blocked && seq.isDue && (step.status === 'scheduled' || step.status === 'prepared');
  const sendBlocker = !active
    ? 'Takip aktif değil.'
    : blocked
      ? 'Takip engelli; yukarıdaki nedeni çöz.'
      : !seq.isDue
        ? 'Takip zamanı henüz gelmedi.'
        : step.status !== 'approved' || dirty
          ? 'Önce taslağı kaydedip onayla.'
          : gmail?.state !== 'connected'
            ? "Gmail bağlı değil. Ayarlar & Otomasyon'dan Gmail'i bağla."
            : null;

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>, toast?: { title: string; description?: string }) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      if (toast) showToast(toast);
      return true;
    } catch (e) {
      if (!(e instanceof DataApiError && e.code === 'cancelled')) setError(asProblem(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const onPrepare = () => {
    controller.current = new AbortController();
    void run('prepare', () => prepare(step.id, controller.current!.signal), {
      title: draft ? 'Takip taslağı yeniden oluşturuldu' : 'Takip taslağı hazırlandı',
      description: 'İncelemeye hazır. Hiçbir mail gönderilmedi.',
    });
  };

  const onSend = async () => {
    if (!keyRef.current || busy) return;
    setBusy('send');
    setError(null);
    try {
      await send(step.id, keyRef.current);
      keyRef.current = null;
      setConfirming(false);
      showToast({ title: 'Takip maili gönderildi', description: `${stepLabel(step.stepNumber)} aynı Gmail konuşmasında gönderildi.` });
    } catch (e) {
      setError(asProblem(e));
      // A new reply ends the sequence and this editor with it: the message must outlive it.
      if (e instanceof DataApiError && e.code === 'followup_reply_found') showToast({ title: 'Yeni yanıt bulundu, takip gönderilmedi', description: e.message });
      // A refused or unclear send ends this confirmation; Berk sees why first.
      keyRef.current = null;
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fu-work">
      <p className="fu-work__title">
        {stepLabel(step.stepNumber)} ·{' '}
        {step.dueAt ? (seq.isDue ? `Takip zamanı geldi (${shortDate(step.dueAt)})` : `Takip tarihi: ${shortDate(step.dueAt)}`) : 'Tarih bekleniyor'}
      </p>

      {step.status === 'scheduled' && (
        <>
          {!seq.isDue && <p className="fu-panel__hint">Takip zamanı geldiğinde taslağı hazırlayabilirsin. KITE kendiliğinden taslak üretmez veya mail göndermez.</p>}
          {seq.isDue && active && !blocked && <p className="fu-panel__hint">Takip taslağı yalnızca aşağıdaki butona bastığında hazırlanır.</p>}
          <div className="mail-editor__actions">
            <button type="button" className="button button--primary" onClick={onPrepare} disabled={!canPrepare || busy !== null}>
              {busy === 'prepare' ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
              {busy === 'prepare' ? 'Hazırlanıyor…' : 'Takip Taslağını Hazırla'}
            </button>
            {busy === 'prepare' && (
              <button type="button" className="button button--ghost" onClick={() => controller.current?.abort()}>
                Durdur
              </button>
            )}
          </div>
        </>
      )}

      {draft && (step.status === 'prepared' || step.status === 'approved') && (
        <div className="fu-editor">
          <div className="fu-editor__head">
            <Badge tone={DRAFT_TONE[draft.status]}>{MAIL_DRAFT_STATUS_LABELS[draft.status]}</Badge>
            <span className="fu-panel__hint">Son üretim: {formatDateTime(new Date(draft.generatedAt))}</span>
          </div>
          <div className="field">
            <span className="field__label">Konu</span>
            <p className="fu-editor__subject">
              {seq.subject} <span className="fu-panel__hint">· Mevcut konuşmanın konusu korunur; takip aynı Gmail konuşmasında gönderilir.</span>
            </p>
          </div>
          <label className="field">
            <span className="field__label">Takip metni</span>
            <textarea id="fu-body" className="input textarea fu-editor__textarea" rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <p className="mail-editor__meta">
            {words} kelime (hedef 40 ile 100, en fazla {MAX_FOLLOW_UP_WORDS}){dirty && <span className="mail-editor__dirty"> · Kaydedilmemiş değişiklikler</span>}
          </p>
          {draft.generationNotes.followUp && (
            <p className="fu-panel__hint">
              Açı: {draft.generationNotes.followUp.angle} · {draft.generationNotes.serviceReasoning}
              {draft.generationNotes.warnings.length > 0 && ` · ${draft.generationNotes.warnings.join(' ')}`}
            </p>
          )}
          <div className="mail-editor__actions">
            <button type="button" className="button button--secondary" disabled={busy !== null || !dirty || !body.trim()} onClick={() => void run('save', () => save(step.id, body), { title: 'Takip taslağı kaydedildi', description: draft.status === 'approved' ? 'Onay kaldırıldı; tekrar onaylaman gerekiyor.' : undefined })}>
              <Save size={16} aria-hidden="true" /> Kaydet
            </button>
            <button type="button" className="button button--primary" disabled={busy !== null || !body.trim() || !active || blocked || (draft.status === 'approved' && !dirty)} onClick={() => void run('approve', () => approve(step.id, body), { title: 'Takip taslağı onaylandı', description: 'Göndermek için “Gönder…”e bas. Onay hiçbir maili otomatik göndermez.' })}>
              <Check size={16} aria-hidden="true" /> {draft.status === 'approved' && !dirty ? 'Onaylandı' : 'Onayla'}
            </button>
            {step.status === 'prepared' && (
              <button type="button" className="button button--ghost" disabled={busy !== null || !canPrepare} onClick={onPrepare}>
                {busy === 'prepare' ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />} Yeniden Oluştur
              </button>
            )}
          </div>

          {!confirming ? (
            <div className="mail-editor__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={sendBlocker !== null || busy !== null}
                onClick={() => {
                  setError(null);
                  keyRef.current = newIdempotencyKey();
                  setConfirming(true);
                }}
              >
                <Send size={16} aria-hidden="true" /> Gönder…
              </button>
              {sendBlocker && <span className="mail-send__hint">{sendBlocker}</span>}
            </div>
          ) : (
            <div className="mail-send-confirm" role="alertdialog" aria-labelledby="fu-send-title" aria-describedby="fu-send-desc">
              <p id="fu-send-title" className="mail-send-confirm__title">
                <ShieldCheck size={16} aria-hidden="true" /> Takip mailini göndermeden önce son kontrol
              </p>
              <p id="fu-send-desc" className="mail-send__hint">
                Göndermeden hemen önce Gmail konuşması yeni bir yanıt için kontrol edilir; yanıt varsa takip gönderilmez. Gönderilen mail geri alınamaz.
              </p>
              <dl className="mail-send-confirm__facts">
                <div>
                  <dt>Alıcı</dt>
                  <dd>{seq.recipientNameSnapshot ? `${seq.recipientNameSnapshot} <${seq.recipientEmailSnapshot}>` : seq.recipientEmailSnapshot}</dd>
                </div>
                <div>
                  <dt>Gönderen</dt>
                  <dd>
                    {gmail?.email ?? '—'} {gmail?.provider === 'fixture' && <Badge tone="warning">Test Gmail</Badge>}
                  </dd>
                </div>
                <div>
                  <dt>Konu</dt>
                  <dd className="mail-send-confirm__subject">{seq.subject}</dd>
                </div>
                <div>
                  <dt>Konuşma</dt>
                  <dd>Aynı Gmail konuşması ({stepLabel(step.stepNumber)})</dd>
                </div>
              </dl>
              <pre className="mail-send-confirm__body">{draft.body}</pre>
              <div className="mail-confirm__actions">
                <button type="button" className="button button--primary" onClick={() => void onSend()} disabled={busy !== null}>
                  {busy === 'send' ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                  {busy === 'send' ? 'Kontrol ediliyor ve gönderiliyor…' : 'Bu Takip Mailini Gönder'}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy === 'send'}
                  onClick={() => {
                    keyRef.current = null;
                    setConfirming(false);
                  }}
                >
                  Vazgeç
                </button>
              </div>
            </div>
          )}
        </div>
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

      <div className="fu-work__secondary">
        {postponing ? (
          <div className="fu-inline">
            <label className="field">
              <span className="field__label">Yeni takip tarihi</span>
              <input type="date" className="input" value={newDate} min={toDateInputValue(new Date(now.getTime() + 86_400_000).toISOString())} onChange={(e) => setNewDate(e.target.value)} />
            </label>
            <button
              type="button"
              className="button button--secondary button--sm"
              disabled={busy !== null || !newDate}
              onClick={async () => {
                const iso = fromDateInputValue(newDate);
                if (iso && (await run('postpone', () => postpone(step.id, iso), { title: 'Takip ertelendi', description: shortDate(iso) }))) setPostponing(false);
              }}
            >
              Ertele
            </button>
            <button type="button" className="button button--ghost button--sm" onClick={() => setPostponing(false)}>
              Vazgeç
            </button>
          </div>
        ) : confirmSkip ? (
          <div className="fu-inline" role="alertdialog" aria-label="Adımı atla">
            <span className="fu-panel__hint">{stepLabel(step.stepNumber)} gönderilmeden atlanır; sonraki takip bugünden itibaren hesaplanır.</span>
            <button type="button" className="button button--secondary button--sm" disabled={busy !== null || !active} onClick={async () => { if (await run('skip', () => skip(step.id), { title: 'Adım atlandı', description: 'Hiçbir mail gönderilmedi.' })) setConfirmSkip(false); }}>
              Adımı Atla
            </button>
            <button type="button" className="button button--ghost button--sm" onClick={() => setConfirmSkip(false)}>
              Vazgeç
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="button button--ghost button--sm" onClick={() => setPostponing(true)} disabled={busy !== null}>
              <CalendarClock size={14} aria-hidden="true" /> Ertele
            </button>
            <button type="button" className="button button--ghost button--sm" onClick={() => setConfirmSkip(true)} disabled={busy !== null || !active}>
              <SkipForward size={14} aria-hidden="true" /> Adımı Atla
            </button>
          </>
        )}
      </div>
    </div>
  );
}
