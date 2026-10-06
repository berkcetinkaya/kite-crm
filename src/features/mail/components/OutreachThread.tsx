// Sent mail and its replies (Phase 6, extended in Phase 7). One conversation per Gmail thread, in
// chronological order: the first email, follow ups 1 to 3 and the replies, each visibly labelled.
// Visually separate from the draft editor: this is what was actually sent (immutable snapshots) and
// what came back. Gmail content is untrusted and is always rendered as plain text (React escapes it;
// no HTML rendering anywhere). Sends that failed or are unclear keep their own review cards.
import { useMemo, useState } from 'react';
import { CircleAlert, Inbox, Loader2, Paperclip, Search, Send } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import { errorMessage } from '../../../api/dataApi';
import { stepLabel } from '../../../domain/followUp';
import { OUTBOUND_STATUS_LABELS, type OutboundMessage, type OutboundStatus, type ThreadMessage } from '../../../domain/outreach';
import { formatDateTime } from '../../../lib/date';
import { useFollowUps } from '../../../state/followUps/FollowUpsProvider';
import { useOutreach } from '../../../state/outreach/OutreachProvider';

export const OUTBOUND_TONE: Record<OutboundStatus, BadgeTone> = { sending: 'info', sent: 'success', failed: 'danger', ambiguous: 'warning' };

const kb = (bytes: number) => (bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`);

/** "İlk Mail" or "2. Takip", from the draft the send was made from. */
function useSendLabel(): (send: OutboundMessage) => { label: string; step: number } {
  const { drafts } = useFollowUps();
  const steps = useMemo(() => new Map(drafts.map((d) => [d.id, d.followUp?.stepNumber ?? 0])), [drafts]);
  return (send) => {
    const step = steps.get(send.draftId) ?? 0;
    return { label: step ? stepLabel(step) : 'İlk Mail', step };
  };
}

export function OutreachThreads({ companyId }: { companyId: string }) {
  const { sendsFor, messages } = useOutreach();
  const sends = sendsFor(companyId);
  const threads = useMemo(() => {
    const byThread = new Map<string, OutboundMessage[]>();
    for (const s of [...sends].reverse()) if (s.status === 'sent' && s.gmailThreadId) (byThread.get(s.gmailThreadId) ?? byThread.set(s.gmailThreadId, []).get(s.gmailThreadId)!).push(s);
    return [...byThread.entries()];
  }, [sends]);
  const problems = sends.filter((s) => s.status !== 'sent');
  if (sends.length === 0) return null;
  return (
    <section className="card mail-thread" aria-labelledby="mail-thread-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="mail-thread-title" className="card__title">
            Gönderilen Mail ve Yanıtlar
          </h2>
          <p className="card__subtitle">Gönderilen metin değiştirilemez; taslakta sonradan yapılan değişiklikler burayı etkilemez.</p>
        </div>
      </header>
      <div className="card__body mail-thread__body">
        {problems.map((s) => (
          <SendItem key={s.id} send={s} />
        ))}
        {threads.map(([threadId, threadSends]) => (
          <Conversation key={threadId} sends={threadSends} replies={messages.filter((m) => m.gmailThreadId === threadId && m.direction === 'inbound')} />
        ))}
      </div>
    </section>
  );
}

type Entry = { kind: 'out'; at: string; send: OutboundMessage } | { kind: 'in'; at: string; message: ThreadMessage };

/** One Gmail conversation: first email, follow ups and replies in chronological order. */
function Conversation({ sends, replies }: { sends: OutboundMessage[]; replies: ThreadMessage[] }) {
  const labelOf = useSendLabel();
  const entries: Entry[] = [
    ...sends.map((s) => ({ kind: 'out' as const, at: s.sentAt ?? s.attemptedAt, send: s })),
    ...replies.map((m) => ({ kind: 'in' as const, at: m.messageAt, message: m })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const first = sends[0];

  return (
    <article className="mail-sent mail-sent--sent mail-conv" aria-label={`Gönderim: ${first.subject}`}>
      <header className="mail-sent__head">
        <span className="mail-sent__icon" aria-hidden="true">
          <Send size={14} />
        </span>
        <div className="mail-sent__heading">
          <p className="mail-sent__subject">{first.subject}</p>
          <p className="mail-sent__meta">
            Alıcı: {first.recipientName ? `${first.recipientName} <${first.recipientEmail}>` : first.recipientEmail}
            {first.fromEmail && ` · Gönderen: ${first.fromEmail}`}
            {sends.length > 1 && ` · ${sends.length} mail aynı konuşmada`}
          </p>
        </div>
        <Badge tone="success">{OUTBOUND_STATUS_LABELS.sent}</Badge>
      </header>

      <ol className="mail-conv__list">
        {entries.map((e) =>
          e.kind === 'out' ? (
            <li key={e.send.id} className={labelOf(e.send).step ? 'mail-conv__item mail-conv__item--followup' : 'mail-conv__item mail-conv__item--initial'}>
              <p className="mail-conv__head">
                <Badge tone={labelOf(e.send).step ? 'accent' : 'info'}>{labelOf(e.send).label}</Badge>
                <span className="mail-reply__date">Gönderildi: {formatDateTime(new Date(e.at))}</span>
              </p>
              <pre className="mail-sent__body">{e.send.body}</pre>
            </li>
          ) : (
            <li key={e.message.id} className="mail-conv__item mail-conv__item--reply mail-reply">
              <p className="mail-reply__head">
                <Badge tone="success">Yanıt</Badge> <strong>{e.message.fromName ?? e.message.fromEmail}</strong>
                {e.message.fromName && <span className="mail-reply__email"> &lt;{e.message.fromEmail}&gt;</span>}
                <span className="mail-reply__date"> · {formatDateTime(new Date(e.message.messageAt))}</span>
              </p>
              {e.message.subject && <p className="mail-reply__subject">{e.message.subject}</p>}
              <pre className="mail-reply__body">{e.message.bodyText || e.message.snippet}</pre>
              {e.message.attachments.length > 0 && (
                <p className="mail-reply__attachments">
                  <Paperclip size={12} aria-hidden="true" />
                  {e.message.attachments.map((a) => `${a.filename} (${kb(a.size)})`).join(', ')} · Ekler Gmail'de
                </p>
              )}
            </li>
          ),
        )}
      </ol>
      <p className="mail-replies__title">
        <Inbox size={14} aria-hidden="true" /> Yanıtlar ({replies.length})
      </p>
      {replies.length === 0 && <p className="mail-replies__none">Henüz yanıt yok. “Yanıtları Kontrol Et” ile Gmail'deki konuşmayı kontrol edebilirsin.</p>}
    </article>
  );
}

/** A send that is not (or not yet known to be) delivered: failed, in flight or unclear. */
function SendItem({ send }: { send: OutboundMessage }) {
  const { reconcile, markNotSent, gmail } = useOutreach();
  const labelOf = useSendLabel();
  const showToast = useToast();
  const [busy, setBusy] = useState<null | 'reconcile' | 'not_sent'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmNotSent, setConfirmNotSent] = useState(false);

  const act = async (kind: 'reconcile' | 'not_sent') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'reconcile') {
        const r = await reconcile(send.id);
        showToast(
          r.found
            ? { title: "Mail Gmail'de bulundu", description: 'Gönderildi olarak kaydedildi.' }
            : { title: "Mail Gmail'de bulunamadı", description: 'Gönderilmediğinden eminsen “Gönderilmedi olarak işaretle”yi kullan.' },
        );
      } else {
        await markNotSent(send.id);
        setConfirmNotSent(false);
        showToast({ title: 'Gönderilmedi olarak işaretlendi', description: 'Taslak korunuyor; istersen yeniden gönderebilirsin.' });
      }
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(null);
  };

  return (
    <article className={`mail-sent mail-sent--${send.status}`} aria-label={`Gönderim: ${send.subject}`}>
      <header className="mail-sent__head">
        <span className="mail-sent__icon" aria-hidden="true">
          <Send size={14} />
        </span>
        <div className="mail-sent__heading">
          <p className="mail-sent__subject">
            {labelOf(send).step > 0 && <Badge tone="accent">{labelOf(send).label}</Badge>} {send.subject}
          </p>
          <p className="mail-sent__meta">
            Alıcı: {send.recipientName ? `${send.recipientName} <${send.recipientEmail}>` : send.recipientEmail}
            {' · '}
            {send.sentAt ? `Gönderildi: ${formatDateTime(new Date(send.sentAt))}` : `Deneme: ${formatDateTime(new Date(send.attemptedAt))}`}
            {send.fromEmail && ` · Gönderen: ${send.fromEmail}`}
          </p>
        </div>
        <Badge tone={OUTBOUND_TONE[send.status]}>{OUTBOUND_STATUS_LABELS[send.status]}</Badge>
      </header>

      {send.status === 'failed' && send.errorMessage && (
        <p className="research-alert research-alert--error mail-sent__alert" role="status">
          {send.errorMessage}
        </p>
      )}
      {send.status === 'ambiguous' && (
        <div className="mail-review" role="status">
          <p className="mail-review__title">
            <CircleAlert size={14} aria-hidden="true" /> Kontrol gerekiyor
          </p>
          <p>{send.errorMessage}</p>
          <p>KITE bu maili otomatik olarak tekrar göndermez. Önce Gmail'deki “Gönderilenler” klasöründe olup olmadığını kontrol et.</p>
          {confirmNotSent ? (
            <div className="mail-confirm__actions">
              <span>Bu mailin gönderilmediğinden emin misin? Ardından yeniden gönderim mümkün olur.</span>
              <button type="button" className="button button--primary button--sm" onClick={() => void act('not_sent')} disabled={busy !== null}>
                Evet, gönderilmedi
              </button>
              <button type="button" className="button button--secondary button--sm" onClick={() => setConfirmNotSent(false)} disabled={busy !== null}>
                Vazgeç
              </button>
            </div>
          ) : (
            <div className="mail-confirm__actions">
              <button type="button" className="button button--secondary button--sm" onClick={() => void act('reconcile')} disabled={busy !== null || gmail?.state !== 'connected'}>
                {busy === 'reconcile' ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
                Gmail'de Kontrol Et
              </button>
              <button type="button" className="button button--ghost button--sm" onClick={() => setConfirmNotSent(true)} disabled={busy !== null}>
                Gönderilmedi olarak işaretle
              </button>
            </div>
          )}
          {error && (
            <p className="research-alert research-alert--error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <pre className="mail-sent__body">{send.body}</pre>
    </article>
  );
}
