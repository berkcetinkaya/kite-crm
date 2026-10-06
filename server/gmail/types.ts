// Gmail provider adapter contract. UI and business logic depend on this, never on Google APIs.
// Two implementations share it: the real Google one (OAuth + Gmail REST over fetch) and a
// deterministic fixture used by every test and by browser QA.
import type { GmailProviderKind, MailAttachmentMeta } from '../../src/domain/outreach';

export type GmailErrorCode =
  /** No stored credential. */
  | 'not_connected'
  /** Grant revoked/expired or scopes missing: Berk must connect again. */
  | 'reconnect'
  | 'key_missing'
  | 'unreadable'
  | 'oauth_state'
  | 'oauth_denied'
  | 'oauth_failed'
  /** Gmail definitely did not send the message (4xx before/at submission). */
  | 'rejected'
  | 'rate_limit'
  /** The request reached Gmail (or may have) but the outcome is unknown. Never retried automatically. */
  | 'ambiguous'
  /** Gmail/Google unreachable before anything was submitted (nothing sent). */
  | 'unavailable';

export class GmailError extends Error {
  constructor(
    public readonly code: GmailErrorCode,
    /** Technical detail for server logs only (never tokens). */
    public readonly detail = '',
  ) {
    super(`gmail ${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'GmailError';
  }
}

export interface GmailConnection {
  state: 'disconnected' | 'connected' | 'error';
  email: string | null;
  connectedAt: string | null;
  error: GmailErrorCode | null;
}

export interface OutgoingMail {
  /** KITE send id; also written as the X-KITE-Send-Id header so an unclear send can be found. */
  sendId: string;
  to: { email: string; name: string | null };
  subject: string;
  body: string;
  /**
   * Follow ups only (Phase 7): continue an existing conversation. Gmail adds a message to a thread
   * only when the request carries the threadId, the RFC 2822 In-Reply-To and References headers are
   * set, and the Subject matches the thread's subject.
   */
  thread?: MailThreadRef;
}

export interface MailThreadRef {
  threadId: string;
  /** RFC Message-ID of the message being replied to (the conversation's latest KITE message). */
  inReplyTo: string;
  /** RFC Message-IDs of the conversation, oldest first (ends with inReplyTo). */
  references: string[];
}

export interface SentRef {
  messageId: string;
  threadId: string;
  rfcMessageId: string | null;
}

/** A Gmail message reduced to what KITE stores. Plain text only; untrusted content. */
export interface GmailThreadMessage {
  id: string;
  threadId: string;
  rfcMessageId: string | null;
  labelIds: string[];
  from: { email: string; name: string | null };
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  snippet: string;
  messageAt: string;
  attachments: MailAttachmentMeta[];
}

export interface GmailProviderAdapter {
  readonly kind: GmailProviderKind;
  /** False when the server lacks client id/secret/redirect URI (real provider only). */
  readonly configured: boolean;
  /** Stored connection, no network call. */
  connection(): Promise<GmailConnection>;
  /** Re-checks the grant with the provider (token refresh + profile). */
  verify(): Promise<GmailConnection>;
  /** Starts OAuth: returns the provider URL and the state the callback must carry. */
  beginAuthorization(): { authUrl: string; state: string };
  /** Completes OAuth: validates state (single use), exchanges the code, stores the credential. */
  completeAuthorization(params: { code?: string | null; state?: string | null; error?: string | null; stateBound?: boolean }): Promise<{ email: string }>;
  /** Revokes the grant (best effort) and deletes the stored credential. */
  disconnect(): Promise<void>;
  /** Submits one message. Throws GmailError: rejected/rate_limit/reconnect/... = not sent; ambiguous = unknown. */
  send(mail: OutgoingMail): Promise<SentRef>;
  /** Looks for a message KITE sent (by X-KITE-Send-Id) to settle an ambiguous send. */
  findSent(query: { sendId: string; recipient: string; after: string }): Promise<SentRef | null>;
  /** All messages of one thread (only threads KITE stored). */
  getThread(threadId: string): Promise<GmailThreadMessage[]>;
}
