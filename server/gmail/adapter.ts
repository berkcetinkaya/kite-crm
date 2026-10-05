// Gmail adapter core shared by the real Google provider and the fixture: OAuth state + PKCE,
// credential storage, access token refresh and error mapping. Transport specifics live in an
// OAuthClient and a GmailApi (google.ts for real HTTP, fixture.ts for deterministic tests).
//
// Tokens: the refresh token is kept only in the encrypted credential store; access tokens are kept
// in this process's memory only. Neither is ever returned to routes, the browser or logs.
import { createHash, randomBytes } from 'node:crypto';
import type { GmailProviderKind } from '../../src/domain/outreach';
import { CredentialError, type CredentialStore, type StoredGmailCredential } from './credentialStore';
import { buildMime } from './message';
import { GmailError, type GmailConnection, type GmailErrorCode, type GmailProviderAdapter, type GmailThreadMessage, type OutgoingMail, type SentRef } from './types';

/** Minimum scopes: send approved mail + read the threads KITE sent (no modify, no delete). */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'] as const;

export interface OAuthTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  scope?: string;
}

export interface OAuthClient {
  authUrl(params: { state: string; codeChallenge: string }): string;
  exchange(code: string, codeVerifier: string): Promise<OAuthTokens>;
  /** Throws GmailError('reconnect') when the grant is revoked/expired, 'unavailable' on network errors. */
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  revoke(token: string): Promise<void>;
}

export interface GmailApi {
  profile(accessToken: string): Promise<{ email: string }>;
  send(accessToken: string, raw: string, mail: OutgoingMail): Promise<{ messageId: string; threadId: string }>;
  rfcMessageId(accessToken: string, messageId: string): Promise<string | null>;
  findSent(accessToken: string, query: { sendId: string; recipient: string; after: string }): Promise<SentRef | null>;
  getThread(accessToken: string, threadId: string): Promise<GmailThreadMessage[]>;
}

const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 20;

export function createGmailAdapter(deps: {
  kind: GmailProviderKind;
  configured: boolean;
  oauth: OAuthClient;
  api: GmailApi;
  credentials: CredentialStore;
  now?: () => number;
}): GmailProviderAdapter {
  const now = () => deps.now?.() ?? Date.now();
  const pending = new Map<string, { verifier: string; expiresAt: number }>();
  let access: { token: string; expiresAt: number } | null = null;
  /** Last problem with the stored grant (e.g. revoked); cleared by a successful connect/verify. */
  let grantError: GmailErrorCode | null = null;

  async function readCredential(): Promise<StoredGmailCredential | null> {
    try {
      return await deps.credentials.read();
    } catch (e) {
      if (e instanceof CredentialError) throw new GmailError(e.code);
      throw e;
    }
  }

  async function requireCredential(): Promise<StoredGmailCredential> {
    if (!deps.configured) throw new GmailError('not_connected', 'not configured');
    const c = await readCredential();
    if (!c) throw new GmailError('not_connected');
    return c;
  }

  async function accessToken(force = false): Promise<string> {
    const c = await requireCredential();
    if (!force && access && access.expiresAt - 60_000 > now()) return access.token;
    try {
      const t = await deps.oauth.refresh(c.refreshToken);
      access = { token: t.accessToken, expiresAt: now() + t.expiresIn * 1000 };
      grantError = null;
      return t.accessToken;
    } catch (e) {
      access = null;
      if (e instanceof GmailError && e.code === 'reconnect') grantError = 'reconnect';
      throw e;
    }
  }

  /** Runs an API call; a 401 (expired access token) gets exactly one refresh and retry. */
  async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await accessToken());
    } catch (e) {
      if (!(e instanceof GmailError && e.code === 'reconnect' && access)) throw e;
      return fn(await accessToken(true));
    }
  }

  const connectionOf = async (): Promise<GmailConnection> => {
    if (!deps.configured) return { state: 'disconnected', email: null, connectedAt: null, error: null };
    try {
      const c = await readCredential();
      if (!c) return { state: 'disconnected', email: null, connectedAt: null, error: null };
      if (grantError) return { state: 'error', email: c.email, connectedAt: c.connectedAt, error: grantError };
      return { state: 'connected', email: c.email, connectedAt: c.connectedAt, error: null };
    } catch (e) {
      if (e instanceof GmailError) return { state: 'error', email: null, connectedAt: null, error: e.code };
      throw e;
    }
  };

  return {
    kind: deps.kind,
    configured: deps.configured,
    connection: connectionOf,

    async verify() {
      const current = await connectionOf();
      if (current.state === 'disconnected' || (current.state === 'error' && current.error !== 'reconnect')) return current;
      try {
        const token = await accessToken(true);
        await deps.api.profile(token);
      } catch (e) {
        if (!(e instanceof GmailError)) throw e;
        if (e.code === 'reconnect') grantError = 'reconnect';
        else return { ...(await connectionOf()), state: 'error', error: e.code };
      }
      return connectionOf();
    },

    beginAuthorization() {
      if (!deps.configured) throw new GmailError('not_connected', 'not configured');
      // Drop expired states; keep the map small (single user).
      for (const [k, v] of pending) if (v.expiresAt < now()) pending.delete(k);
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
      pending.set(state, { verifier, expiresAt: now() + STATE_TTL_MS });
      return { authUrl: deps.oauth.authUrl({ state, codeChallenge }), state };
    },

    async completeAuthorization({ code, state, error, stateBound = true }) {
      // State first: an unknown/expired/reused state, or one that did not come back to the browser
      // that started the flow, is rejected (and consumed) before anything else happens.
      const entry = state ? pending.get(state) : undefined;
      if (state) pending.delete(state);
      if (!entry || entry.expiresAt < now() || !stateBound) throw new GmailError('oauth_state');
      if (error) throw new GmailError(error === 'access_denied' ? 'oauth_denied' : 'oauth_failed', `provider error ${error}`);
      if (!code) throw new GmailError('oauth_failed', 'missing code');
      const tokens = await deps.oauth.exchange(code, entry.verifier);
      const granted = new Set((tokens.scope ?? '').split(/\s+/));
      if (!tokens.refreshToken) throw new GmailError('oauth_failed', 'no refresh token');
      if (!GMAIL_SCOPES.every((s) => granted.has(s))) throw new GmailError('oauth_denied', 'required scopes not granted');
      const { email } = await deps.api.profile(tokens.accessToken);
      const previous = await readCredential().catch(() => null);
      await deps.credentials.write({ provider: deps.kind, email, refreshToken: tokens.refreshToken, scope: tokens.scope ?? GMAIL_SCOPES.join(' '), connectedAt: new Date(now()).toISOString() });
      access = { token: tokens.accessToken, expiresAt: now() + tokens.expiresIn * 1000 };
      grantError = null;
      // A replaced grant is revoked so only one stays valid.
      if (previous && previous.refreshToken !== tokens.refreshToken) await deps.oauth.revoke(previous.refreshToken).catch(() => undefined);
      return { email };
    },

    async disconnect() {
      const c = await readCredential().catch(() => null);
      if (c) await deps.oauth.revoke(c.refreshToken).catch(() => undefined);
      await deps.credentials.delete();
      access = null;
      grantError = null;
    },

    async send(mail) {
      const c = await requireCredential();
      const raw = buildMime(mail, c.email);
      // Everything before the HTTP submission is a definite "not sent". 401 at submission means
      // Gmail refused the token without processing the message, so one refresh + retry is safe.
      const sent = await withToken((token) => deps.api.send(token, raw, mail));
      // RFC Message-ID is informative only; failing to read it never makes a send unsuccessful.
      const rfcMessageId = await withToken((token) => deps.api.rfcMessageId(token, sent.messageId)).catch(() => null);
      return { messageId: sent.messageId, threadId: sent.threadId, rfcMessageId };
    },

    findSent: (query) => withToken((token) => deps.api.findSent(token, query)),
    getThread: (threadId) => withToken((token) => deps.api.getThread(token, threadId)),
  };
}
