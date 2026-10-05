// Sending one approved draft (Phase 6). Berk explicitly picks a stored contact, presses "Gönder…",
// reviews the full final mail in a confirmation step, and only "Bu Maili Gönder" calls the server.
// Approval alone never sends anything.
import { useRef, useState } from 'react';
import { Loader2, Send, ShieldCheck } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import { DataApiError, errorMessage } from '../../../api/dataApi';
import { newIdempotencyKey } from '../../../api/outreachApi';
import { CONTACT_CONFIDENCE, type Company } from '../../../domain/company';
import type { MailDraft } from '../../../domain/mail/draft';
import { blockingSend, sendableContacts, sendBlocker } from '../../../domain/outreach';
import { useOutreach } from '../../../state/outreach/OutreachProvider';

export function SendPanel({ company, draft, dirty }: { company: Company; draft: MailDraft; dirty: boolean }) {
  const { gmail, sends, send } = useOutreach();
  const showToast = useToast();
  const contacts = sendableContacts(company);
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** One key per confirmation: a retry of the same confirmation can never send twice. */
  const keyRef = useRef<string | null>(null);

  const companySends = sends.filter((s) => s.companyId === company.id);
  const blocker = sendBlocker({ draft, dirty, gmailConnected: gmail?.state === 'connected', company, sends: companySends });
  const recipient = contacts.find((c) => c.id === recipientId) ?? null;
  const sent = blockingSend(companySends, draft.id);

  // Once sent (or under review) the thread card below shows the state; nothing to choose here.
  if (sent) return null;

  const source = company.researchRef ? `KITE araştırması${company.researchRef.mode === 'real' ? ' (herkese açık kaynak)' : ''}` : 'Elle eklendi';

  const openConfirm = () => {
    setError(null);
    keyRef.current = newIdempotencyKey();
    setConfirming(true);
  };

  const onSend = async () => {
    if (!recipient || !keyRef.current || sending) return;
    setSending(true);
    setError(null);
    try {
      await send({ draftId: draft.id, companyId: company.id, contactId: recipient.id, idempotencyKey: keyRef.current });
      setConfirming(false);
      keyRef.current = null;
      showToast({ title: 'Mail gönderildi', description: `${company.name} · ${recipient.email}` });
    } catch (e) {
      setError(errorMessage(e));
      // A definite failure or an unclear result ends this confirmation: Berk inspects it first.
      if (e instanceof DataApiError && e.details.send) {
        setConfirming(false);
        keyRef.current = null;
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mail-send" aria-labelledby="mail-send-title">
      <p id="mail-send-title" className="mail-send__title">
        <Send size={14} aria-hidden="true" /> Gönderim
      </p>
      {contacts.length === 0 ? (
        <p className="mail-send__hint">Bu şirkette geçerli e-posta adresi olan bir iletişim kişisi yok. Gönderim için Potansiyel Müşteriler'de kişi ekle; KITE adres tahmin etmez.</p>
      ) : (
        <fieldset className="mail-send__recipients" disabled={sending || confirming}>
          <legend className="field__label">Alıcı seç</legend>
          {contacts.map((c) => (
            <label key={c.id} className={c.id === recipientId ? 'mail-recipient mail-recipient--active' : 'mail-recipient'}>
              <input type="radio" name="mail-recipient" checked={c.id === recipientId} onChange={() => setRecipientId(c.id)} />
              <span className="mail-recipient__main">
                <span className="mail-recipient__name">
                  {c.fullName}
                  {c.role && <span className="mail-recipient__role"> · {c.role}</span>}
                </span>
                <span className="mail-recipient__email">{c.email}</span>
                <span className="mail-recipient__meta">
                  Kaynak: {source} · Güven: {CONTACT_CONFIDENCE[c.confidence]}
                  {c.isDecisionMaker && ' · Karar verici'}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {blocker && <p className="mail-send__hint" role="status">{blocker}</p>}
      {error && (
        <p className="research-alert research-alert--error mail-send__error" role="alert">
          {error}
        </p>
      )}

      {!confirming ? (
        <div className="mail-editor__actions">
          <button type="button" className="button button--primary" onClick={openConfirm} disabled={blocker !== null || !recipient}>
            <Send size={16} aria-hidden="true" />
            Gönder…
          </button>
          {!blocker && !recipient && <span className="mail-send__hint">Önce alıcıyı seç.</span>}
        </div>
      ) : (
        recipient && (
          <div className="mail-send-confirm" role="alertdialog" aria-labelledby="mail-send-confirm-title" aria-describedby="mail-send-confirm-desc">
            <p id="mail-send-confirm-title" className="mail-send-confirm__title">
              <ShieldCheck size={16} aria-hidden="true" /> Göndermeden önce son kontrol
            </p>
            <p id="mail-send-confirm-desc" className="mail-send__hint">
              Bu mail Gmail hesabından hemen gönderilir ve geri alınamaz.
            </p>
            <dl className="mail-send-confirm__facts">
              <div>
                <dt>Alıcı</dt>
                <dd>
                  {recipient.fullName} &lt;{recipient.email}&gt;
                </dd>
              </div>
              <div>
                <dt>Şirket</dt>
                <dd>{company.name}</dd>
              </div>
              <div>
                <dt>Gönderen</dt>
                <dd>
                  {gmail?.email ?? '—'} {gmail?.provider === 'fixture' && <Badge tone="warning">Test Gmail</Badge>}
                </dd>
              </div>
              <div>
                <dt>Konu</dt>
                <dd className="mail-send-confirm__subject">{draft.selectedSubject}</dd>
              </div>
            </dl>
            <pre className="mail-send-confirm__body">{draft.body}</pre>
            {dirty && <p className="mail-send__hint">Editörde kaydedilmemiş değişiklik var. Gönderilecek olan yukarıdaki onaylı metindir; değişiklikleri göndermek için önce kaydedip yeniden onayla.</p>}
            <div className="mail-confirm__actions">
              <button type="button" className="button button--primary" onClick={() => void onSend()} disabled={sending || dirty}>
                {sending ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                {sending ? 'Gönderiliyor…' : 'Bu Maili Gönder'}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  setConfirming(false);
                  keyRef.current = null;
                }}
                disabled={sending}
              >
                Vazgeç
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
