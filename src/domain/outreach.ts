// Outreach (Phase 6): sending an approved first contact mail through Gmail and tracking replies.
// Shared by the server (rules, persistence) and the browser (labels, eligibility hints). The server
// is the authority: the browser only mirrors these rules to explain why sending is unavailable.
import { isGeneralContact, type Company, type Contact } from './company';
import { isValidEmail } from '../lib/email';
import type { MailDraft, MailLanguage } from './mail/draft';
import { SALES_STAGES, type SalesStatus } from './salesStatus';
import type { ServiceKey } from './services';

/**
 * sending   → a send record exists and the Gmail request is in flight (or the server stopped mid-send)
 * sent      → Gmail confirmed the message (ids stored)
 * failed    → Gmail definitely did not send it (rejected, or failed before submission)
 * ambiguous → unclear whether Gmail accepted it (timeout, network error, 5xx): manual review, no retry
 */
export const OUTBOUND_STATUSES = ['sending', 'sent', 'failed', 'ambiguous'] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

export const OUTBOUND_STATUS_LABELS: Record<OutboundStatus, string> = {
  sending: 'Gönderiliyor',
  sent: 'Gönderildi',
  failed: 'Gönderilemedi',
  ambiguous: 'Kontrol gerekiyor',
};

export type GmailProviderKind = 'gmail' | 'fixture';

/** How an unclear send was settled by Berk (or by the server after a restart). */
export type OutboundResolution = 'reconciled' | 'marked_not_sent' | 'interrupted';

/** One send attempt. Subject and body are an immutable snapshot of exactly what was submitted. */
export interface OutboundMessage {
  id: string;
  companyId: string;
  draftId: string;
  contactId: string | null;
  recipientEmail: string;
  recipientName: string | null;
  /** Connected Gmail account at the time of sending. */
  fromEmail: string | null;
  subject: string;
  body: string;
  service: ServiceKey;
  language: MailLanguage;
  /** Fingerprint of the approved draft revision that was submitted. */
  revisionKey: string;
  provider: GmailProviderKind;
  status: OutboundStatus;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  resolution: OutboundResolution | null;
  attemptedAt: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailAttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
}

/** A message in a KITE Gmail thread: KITE's own send (outbound) or a reply (inbound). Plain text only. */
export interface ThreadMessage {
  id: string;
  outboundId: string;
  companyId: string;
  gmailThreadId: string;
  gmailMessageId: string;
  rfcMessageId: string | null;
  direction: 'inbound' | 'outbound';
  fromEmail: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  /** Normalized plain text (HTML converted to text). Untrusted: always rendered as text. */
  bodyText: string;
  snippet: string;
  messageAt: string;
  syncedAt: string;
  /** Metadata only; attachments are not downloaded. */
  attachments: MailAttachmentMeta[];
}

export interface SyncRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'partial' | 'failed';
  threadsChecked: number;
  newReplies: number;
  errorCode: string | null;
  errorMessage: string | null;
}

// ---------- Gmail connection (browser-safe view; never contains tokens) ----------

export type GmailConnectionState = 'not_configured' | 'disconnected' | 'connected' | 'error';

export interface GmailStatusResponse {
  provider: GmailProviderKind | null;
  state: GmailConnectionState;
  /** Connected Google account (never a token). */
  email: string | null;
  connectedAt: string | null;
  lastSync: SyncRun | null;
  /** Last successful sync, if any. */
  lastSuccessfulSyncAt: string | null;
  error: { code: OutreachErrorCode; message: string } | null;
}

// ---------- Errors ----------

export type OutreachErrorCode =
  | 'gmail_not_configured'
  | 'gmail_not_connected'
  | 'gmail_reconnect'
  | 'credentials_key_missing'
  | 'credentials_unreadable'
  | 'oauth_state'
  | 'oauth_denied'
  | 'oauth_failed'
  | 'draft_not_found'
  | 'draft_not_approved'
  | 'draft_company_mismatch'
  | 'recipient_missing'
  | 'recipient_invalid'
  | 'already_sent'
  | 'send_in_progress'
  | 'needs_review'
  | 'send_rejected'
  | 'send_ambiguous'
  | 'rate_limit'
  | 'not_ambiguous'
  | 'gmail_unavailable'
  | 'sync_running'
  | 'sync_failed';

export const OUTREACH_ERROR_MESSAGES: Record<OutreachErrorCode, string> = {
  gmail_not_configured: "Gmail bağlantısı yapılandırılmamış. Ayarlar & Otomasyon'daki talimatlara bak.",
  gmail_not_connected: "Gmail bağlı değil. Ayarlar & Otomasyon'dan Gmail'i bağla.",
  gmail_reconnect: "Gmail bağlantısının süresi doldu veya iptal edildi. Ayarlar & Otomasyon'dan yeniden bağlan.",
  credentials_key_missing: 'Gmail bağlantısı saklanamıyor: sunucuda KITE_CREDENTIALS_KEY tanımlı değil ya da geçersiz (32 baytlık base64 anahtar gerekir).',
  credentials_unreadable: "Kayıtlı Gmail bağlantısı okunamadı (şifreleme anahtarı değişmiş olabilir). Bağlantıyı kesip yeniden bağlan.",
  oauth_state: 'Gmail bağlantısı doğrulanamadı (oturum süresi dolmuş olabilir). Lütfen tekrar dene.',
  oauth_denied: 'Gmail bağlantısına izin verilmedi.',
  oauth_failed: 'Gmail bağlantısı tamamlanamadı. Lütfen tekrar dene.',
  draft_not_found: 'Mail taslağı bulunamadı.',
  draft_not_approved: 'Yalnızca onaylanmış taslaklar gönderilebilir. Önce taslağı onayla.',
  draft_company_mismatch: 'Taslak seçilen şirkete ait değil.',
  recipient_missing: 'Alıcı seçilmedi. Kayıtlı bir iletişim kişisi seç.',
  recipient_invalid: 'Seçilen kişinin geçerli bir e-posta adresi yok.',
  already_sent: 'Bu taslak zaten gönderildi. Aynı mail ikinci kez gönderilmez.',
  send_in_progress: 'Bu mail şu anda gönderiliyor. Lütfen bekle.',
  needs_review: "Önceki gönderimin sonucu belirsiz. Tekrar göndermeden önce Gmail'de kontrol et.",
  send_rejected: "Gmail maili göndermedi. Taslak korunuyor; kontrol edip tekrar deneyebilirsin.",
  send_ambiguous: "Gmail'den yanıt alınamadı; mailin gidip gitmediği belirsiz. Otomatik tekrar denenmedi, kontrol gerekiyor.",
  rate_limit: 'Gmail gönderim sınırına ulaşıldı. Mail gönderilmedi; biraz sonra tekrar dene.',
  not_ambiguous: 'Bu gönderim kontrol beklemiyor.',
  gmail_unavailable: "Gmail'e ulaşılamadı; mail gönderilmedi. Biraz sonra tekrar dene.",
  sync_running: 'Yanıt kontrolü zaten sürüyor.',
  sync_failed: 'Yanıtlar kontrol edilemedi. Lütfen tekrar dene.',
};

// ---------- Rules ----------

export { isValidEmail } from '../lib/email';

/**
 * Contacts Berk can send to: stored contacts with a valid email address. People come first; the
 * company's general address (info@, hello@ …) is offered last, for when no person is known.
 */
export function sendableContacts(company: Company): Contact[] {
  const withEmail = company.contacts.filter((c) => isValidEmail(c.email));
  return [...withEmail.filter((c) => !isGeneralContact(c)), ...withEmail.filter(isGeneralContact)];
}

const stageIndex = (s: SalesStatus) => (SALES_STAGES as readonly string[]).indexOf(s);

/**
 * Pipeline position after a confirmed send: early stages move to İlk Temas; later stages and side
 * states (İlgilenmiyor, Kaybedildi, …) stay where they are. Never moves backwards.
 */
export function statusAfterSend(current: SalesStatus): SalesStatus {
  const i = stageIndex(current);
  return i >= 0 && i < stageIndex('first_contact') ? 'first_contact' : current;
}

/** After a reply: stages before Yanıt Geldi move to it; later stages and side states are kept. */
export function statusAfterReply(current: SalesStatus): SalesStatus {
  const i = stageIndex(current);
  return i >= 0 && i < stageIndex('replied') ? 'replied' : current;
}

/** Sends that block another send of the same draft (Phase 6: one first contact mail per draft). */
export function blockingSend(sends: readonly OutboundMessage[], draftId: string): OutboundMessage | undefined {
  return sends.find((s) => s.draftId === draftId && s.status !== 'failed');
}

/**
 * Why this draft cannot be sent now (Turkish), or null when it can. The server applies the same
 * rules with its own stored data; this copy only explains the disabled button.
 */
export function sendBlocker(input: { draft: MailDraft | undefined; dirty: boolean; gmailConnected: boolean; company: Company; sends: readonly OutboundMessage[] }): string | null {
  const { draft, company } = input;
  if (!draft) return 'Önce bir taslak hazırla.';
  const blocking = blockingSend(input.sends, draft.id);
  if (blocking?.status === 'sent') return OUTREACH_ERROR_MESSAGES.already_sent;
  if (blocking?.status === 'sending') return OUTREACH_ERROR_MESSAGES.send_in_progress;
  if (blocking?.status === 'ambiguous') return OUTREACH_ERROR_MESSAGES.needs_review;
  if (draft.status !== 'approved' || input.dirty) return OUTREACH_ERROR_MESSAGES.draft_not_approved;
  if (sendableContacts(company).length === 0) return 'Bu şirkette geçerli e-posta adresi olan bir iletişim kişisi yok. Gönderim için önce kişi ekle.';
  if (!input.gmailConnected) return OUTREACH_ERROR_MESSAGES.gmail_not_connected;
  return null;
}
