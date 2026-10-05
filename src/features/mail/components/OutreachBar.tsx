import { useState } from 'react';
import { Inbox, Loader2 } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import { errorMessage } from '../../../api/dataApi';
import { formatDateTime } from '../../../lib/date';
import { useOutreach } from '../../../state/outreach/OutreachProvider';
import { GMAIL_VIEW, gmailView } from '../../outreach/gmailStatus';

/** Compact Gmail status + manual reply check ("Yanıtları Kontrol Et"). */
export function OutreachBar() {
  const { gmail, gmailError, syncing, sync, sends } = useOutreach();
  const showToast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<number | null>(null);
  const view = gmailView(gmail, { error: gmailError });
  const state = GMAIL_VIEW[view];
  const threads = sends.filter((s) => s.status === 'sent').length;
  const lastSync = gmail?.lastSync ?? null;

  const onSync = async () => {
    setError(null);
    try {
      const r = await sync();
      setLastResult(r.run.newReplies);
      showToast({ title: r.run.newReplies ? `${r.run.newReplies} yeni yanıt` : 'Yeni yanıt yok', description: `${r.run.threadsChecked} konuşma kontrol edildi.` });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="outreach-bar" aria-label="Gmail ve yanıtlar">
      <div className="outreach-bar__gmail">
        <Badge tone={state.tone} dot>
          {state.label}
        </Badge>
        {gmail?.state === 'connected' && <span className="outreach-bar__account">{gmail.email}</span>}
        {gmail?.provider === 'fixture' && <Badge tone="warning">Test Gmail (fixture)</Badge>}
        {gmail?.state !== 'connected' && (
          <a className="link-button" href="#/settings">
            Ayarlar &amp; Otomasyon'da yönet
          </a>
        )}
      </div>
      <div className="outreach-bar__sync">
        <span className="outreach-bar__meta">
          {lastSync?.finishedAt ? `Son kontrol: ${formatDateTime(new Date(lastSync.finishedAt))}` : 'Henüz yanıt kontrolü yapılmadı'}
          {lastSync?.finishedAt && lastSync.status !== 'failed' && ` · ${lastResult ?? lastSync.newReplies} yeni yanıt`}
          {threads > 0 && ` · ${threads} konuşma`}
        </span>
        <button type="button" className="button button--secondary button--sm" onClick={() => void onSync()} disabled={syncing || gmail?.state !== 'connected'}>
          {syncing ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Inbox size={14} aria-hidden="true" />}
          {syncing ? 'Kontrol ediliyor…' : 'Yanıtları Kontrol Et'}
        </button>
      </div>
      {(error || (lastSync?.status === 'failed' && lastSync.errorMessage)) && (
        <p className="research-alert research-alert--error outreach-bar__error" role="alert">
          {error ?? lastSync?.errorMessage}
        </p>
      )}
    </section>
  );
}
