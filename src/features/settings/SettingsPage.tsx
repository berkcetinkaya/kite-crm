// Ayarlar & Otomasyon (Phase 6): Gmail connection management. OAuth happens on the server; this
// page only shows the connection state and starts/ends it. No token ever reaches the browser.
import { useEffect, useState } from 'react';
import { Loader2, Mail, RefreshCw, Unplug } from 'lucide-react';
import { readHashParams } from '../../app/useHashRoute';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../api/dataApi';
import { OUTREACH_ERROR_MESSAGES, type OutreachErrorCode } from '../../domain/outreach';
import { formatDateTime } from '../../lib/date';
import { useOutreach } from '../../state/outreach/OutreachProvider';
import { GMAIL_VIEW, gmailView } from '../outreach/gmailStatus';
import './settings.css';

const SETTINGS_ROUTE = '#/settings';

export function SettingsPage() {
  const { gmail, gmailError, refreshGmail, verifyGmail, connectGmail, disconnectGmail } = useOutreach();
  const showToast = useToast();
  const [busy, setBusy] = useState<null | 'connect' | 'verify' | 'disconnect'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Result of the OAuth round trip arrives once through the URL (?gmail=connected|error&code=…).
  useEffect(() => {
    const params = readHashParams();
    const result = params.get('gmail');
    if (!result) return;
    window.history.replaceState(null, '', SETTINGS_ROUTE);
    if (result === 'connected') {
      showToast({ title: 'Gmail bağlandı', description: 'Onayladığın mailler artık Gmail üzerinden gönderilebilir.' });
    } else {
      const code = params.get('code') as OutreachErrorCode | null;
      setActionError(code && code in OUTREACH_ERROR_MESSAGES ? OUTREACH_ERROR_MESSAGES[code] : OUTREACH_ERROR_MESSAGES.oauth_failed);
    }
    void refreshGmail();
  }, [showToast, refreshGmail]);

  const view = gmailView(gmail, { error: gmailError, connecting: busy === 'connect' });
  const state = GMAIL_VIEW[view];
  const connected = gmail?.state === 'connected';
  const hasCredential = connected || gmail?.state === 'error';

  const run = async (kind: 'connect' | 'verify' | 'disconnect') => {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === 'connect') {
        await connectGmail(); // navigates to Google (or the fixture callback)
        return;
      }
      if (kind === 'verify') {
        const s = await verifyGmail();
        if (s.state === 'connected') showToast({ title: 'Gmail bağlantısı doğrulandı', description: s.email ?? '' });
      } else {
        await disconnectGmail();
        setConfirmDisconnect(false);
        showToast({ title: 'Gmail bağlantısı kesildi', description: 'Kayıtlı Gmail yetkisi silindi.' });
      }
    } catch (e) {
      setActionError(errorMessage(e));
    }
    setBusy(null);
  };

  return (
    <div className="page settings">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Ayarlar &amp; Otomasyon</h1>
          <p className="page-header__subtitle">KITE'ın bağlı olduğu hesaplar ve otomasyon ayarları.</p>
        </div>
      </header>

      <section className="card gmail-card" aria-labelledby="gmail-card-title">
        <header className="card__header">
          <div className="card__heading">
            <h2 id="gmail-card-title" className="card__title">
              <Mail size={16} aria-hidden="true" /> Gmail Bağlantısı
            </h2>
            <p className="card__subtitle">Onayladığın ilk temas maillerini gönderir ve bu maillere gelen yanıtları takip eder.</p>
          </div>
          <div className="card__action">
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
          </div>
        </header>
        <div className="card__body gmail-card__body">
          <dl className="gmail-card__facts">
            <div>
              <dt>Durum</dt>
              <dd className="gmail-card__state">{state.label}</dd>
            </div>
            <div>
              <dt>Google hesabı</dt>
              <dd className="gmail-card__account">{gmail?.email ?? <span className="text-subtle">—</span>}</dd>
            </div>
            <div>
              <dt>Bağlantı tarihi</dt>
              <dd>{gmail?.connectedAt ? formatDateTime(new Date(gmail.connectedAt)) : <span className="text-subtle">—</span>}</dd>
            </div>
            <div>
              <dt>Son yanıt kontrolü</dt>
              <dd>{gmail?.lastSuccessfulSyncAt ? formatDateTime(new Date(gmail.lastSuccessfulSyncAt)) : <span className="text-subtle">Henüz yapılmadı</span>}</dd>
            </div>
          </dl>
          {gmail?.provider === 'fixture' && (
            <p className="gmail-card__note">
              <Badge tone="warning">Test sağlayıcı (fixture)</Badge> Gerçek Gmail kullanılmıyor; hiçbir gerçek mail gönderilmez.
            </p>
          )}

          {gmail?.error && (
            <p className="settings-alert settings-alert--error" role="alert">
              {gmail.error.message}
            </p>
          )}
          {gmailError && !gmail && (
            <p className="settings-alert settings-alert--error" role="alert">
              {gmailError}
            </p>
          )}
          {actionError && (
            <p className="settings-alert settings-alert--error" role="alert">
              {actionError}
            </p>
          )}
          {view === 'not_configured' && (
            <p className="settings-alert" role="status">
              Gmail bağlantısı için sunucuda KITE_GMAIL_CLIENT_ID, KITE_GMAIL_CLIENT_SECRET, KITE_GMAIL_REDIRECT_URI ve KITE_CREDENTIALS_KEY tanımlanmalı (bkz. README).
            </p>
          )}

          {confirmDisconnect ? (
            <div className="gmail-card__confirm" role="alertdialog" aria-labelledby="gmail-disconnect-title">
              <p id="gmail-disconnect-title" className="gmail-card__confirm-title">
                Gmail bağlantısı kesilsin mi?
              </p>
              <p>KITE'ın Gmail yetkisi Google'da iptal edilir ve kayıtlı yetki silinir. Gönderilmiş mailler ve yanıtlar KITE'ta kalır.</p>
              <div className="gmail-card__actions">
                <button type="button" className="button button--primary button--sm" onClick={() => void run('disconnect')} disabled={busy !== null}>
                  {busy === 'disconnect' && <Loader2 size={14} className="spin" aria-hidden="true" />}
                  Bağlantıyı Kes
                </button>
                <button type="button" className="button button--secondary button--sm" onClick={() => setConfirmDisconnect(false)} disabled={busy !== null}>
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <div className="gmail-card__actions">
              {!connected && view !== 'not_configured' && view !== 'checking' && view !== 'unreachable' && (
                <button type="button" className="button button--primary" onClick={() => void run('connect')} disabled={busy !== null}>
                  {busy === 'connect' ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Mail size={16} aria-hidden="true" />}
                  {busy === 'connect' ? 'Gmail bağlanıyor…' : "Gmail'i Bağla"}
                </button>
              )}
              {hasCredential && (
                <button type="button" className="button button--secondary" onClick={() => void run('verify')} disabled={busy !== null}>
                  {busy === 'verify' ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                  Bağlantıyı Yenile
                </button>
              )}
              {hasCredential && (
                <button type="button" className="button button--ghost" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}>
                  <Unplug size={16} aria-hidden="true" />
                  Bağlantıyı Kes
                </button>
              )}
              {view === 'unreachable' && (
                <button type="button" className="button button--secondary" onClick={() => void refreshGmail()}>
                  Tekrar dene
                </button>
              )}
            </div>
          )}

          <p className="gmail-card__help">
            KITE yalnızca senin açıkça “Bu Maili Gönder” dediğin mailleri gönderir ve yalnızca KITE'tan gönderilen konuşmalardaki yanıtları okur. Gelen kutunda hiçbir şeyi silmez veya değiştirmez.
          </p>
        </div>
      </section>

      <p className="settings__more">Diğer otomasyon ayarları sonraki aşamalarda eklenecek.</p>
    </div>
  );
}
