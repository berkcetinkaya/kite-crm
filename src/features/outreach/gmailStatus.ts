// Turkish labels for the Gmail connection, shared by Ayarlar & Otomasyon and Mail & Takip.
import type { BadgeTone } from '../../components/ui/Badge';
import type { GmailStatusResponse } from '../../domain/outreach';

export type GmailView = 'checking' | 'connecting' | 'not_configured' | 'disconnected' | 'connected' | 'error' | 'unreachable';

export const GMAIL_VIEW: Record<GmailView, { label: string; tone: BadgeTone }> = {
  checking: { label: 'Kontrol ediliyor…', tone: 'neutral' },
  connecting: { label: 'Gmail bağlanıyor', tone: 'info' },
  not_configured: { label: 'Gmail yapılandırılmamış', tone: 'neutral' },
  disconnected: { label: 'Gmail bağlı değil', tone: 'warning' },
  connected: { label: 'Gmail bağlı', tone: 'success' },
  error: { label: 'Gmail bağlantı hatası', tone: 'danger' },
  unreachable: { label: 'Sunucuya ulaşılamıyor', tone: 'danger' },
};

export function gmailView(status: GmailStatusResponse | null, opts: { error?: string | null; connecting?: boolean } = {}): GmailView {
  if (opts.connecting) return 'connecting';
  if (!status) return opts.error ? 'unreachable' : 'checking';
  return status.state;
}
