// Sent mail and its replies (Phase 6). Visually separate from the draft editor: this is what was
// actually sent (immutable snapshot) and what came back. Gmail content is untrusted and is always
// rendered as plain text (React escapes it; no HTML rendering anywhere).
import { useState } from 'react';
import { CircleAlert, Inbox, Loader2, Paperclip, Search, Send } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import { errorMessage } from '../../../api/dataApi';
import { OUTBOUND_STATUS_LABELS, type OutboundMessage, type OutboundStatus } from '../../../domain/outreach';
import { formatDateTime } from '../../../lib/date';
import { useOutreach } from '../../../state/outreach/OutreachProvider';

export const OUTBOUND_TONE: Record<OutboundStatus, BadgeTone> = { sending: 'info', sent: 'success', failed: 'danger', ambiguous: 'warning' };

const kb = (bytes: number) => (bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`);

export function OutreachThreads({ companyId }: { companyId: string }) {
  const { sendsFor } = useOutreach();
  const sends = sendsFor(companyId);
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
        {sends.map((s) => (
          <SendItem key={s.id} send={s} />
        ))}
      </div>
    </section>
  );
}

function SendItem({ send }: { send: OutboundMessage }) {
  const { messagesFor, reconcile, markNotSent, gmail } = useOutreach();
  const showToast = useToast();
  const replies = messagesFor(send.id).filter((m) => m.direction === 'inbound');
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
          <p className="mail-sent__subject">{send.subject}</p>
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

      {send.status === 'sent' && (
        <div className="mail-replies">
          <p className="mail-replies__title">
            <Inbox size={14} aria-hidden="true" /> Yanıtlar ({replies.length})
          </p>
          {replies.length === 0 ? (
            <p className="mail-replies__none">Henüz yanıt yok. “Yanıtları Kontrol Et” ile Gmail'deki konuşmayı kontrol edebilirsin.</p>
          ) : (
            <ol className="mail-replies__list">
              {replies.map((m) => (
                <li key={m.id} className="mail-reply">
                  <p className="mail-reply__head">
                    <strong>{m.fromName ?? m.fromEmail}</strong>
                    {m.fromName && <span className="mail-reply__email"> &lt;{m.fromEmail}&gt;</span>}
                    <span className="mail-reply__date"> · {formatDateTime(new Date(m.messageAt))}</span>
                  </p>
                  {m.subject && <p className="mail-reply__subject">{m.subject}</p>}
                  <pre className="mail-reply__body">{m.bodyText || m.snippet}</pre>
                  {m.attachments.length > 0 && (
                    <p className="mail-reply__attachments">
                      <Paperclip size={12} aria-hidden="true" />
                      {m.attachments.map((a) => `${a.filename} (${kb(a.size)})`).join(', ')} · Ekler Gmail'de
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}
