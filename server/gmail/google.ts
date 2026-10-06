// Real Google transport: OAuth 2.0 web server flow (state + PKCE S256) and the Gmail REST API over
// fetch. No Google SDK; `fetch` is injectable so tests run against fake HTTP responses only.
// Endpoints per Google's current documentation:
//   https://developers.google.com/identity/protocols/oauth2/web-server
//   https://developers.google.com/workspace/gmail/api/reference/rest
// Logged details contain HTTP status and Google error codes only, never tokens or message content.
import { GMAIL_SCOPES, type GmailApi, type OAuthClient, type OAuthTokens } from './adapter';
import { header, normalizeApiMessage, toBase64Url, type ApiMessage } from './message';
import { GmailError, type GmailErrorCode, type SentRef } from './types';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type Fetch = typeof fetch;

async function errorCodeOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string | { status?: string; errors?: { reason?: string }[] } } | null;
  if (!body?.error) return '';
  if (typeof body.error === 'string') return body.error;
  return [body.error.status, ...(body.error.errors ?? []).map((e) => e.reason)].filter(Boolean).join(',');
}

export function createGoogleOAuthClient(config: GoogleOAuthConfig, fetchImpl: Fetch = fetch, timeoutMs = 15_000): OAuthClient {
  async function tokenRequest(params: Record<string, string>, failure: GmailErrorCode): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new GmailError('unavailable', 'token endpoint unreachable');
    }
    if (!res.ok) {
      const code = await errorCodeOf(res);
      // invalid_grant: code reused/expired, or the refresh token was revoked or expired.
      if (code === 'invalid_grant' || res.status === 401) throw new GmailError(failure, `token ${res.status} ${code}`);
      throw new GmailError(res.status >= 500 ? 'unavailable' : failure, `token ${res.status} ${code}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    authUrl({ state, codeChallenge }) {
      const u = new URL(GOOGLE_AUTH_URL);
      u.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: GMAIL_SCOPES.join(' '),
        access_type: 'offline',
        // Always show consent so Google returns a refresh token on every (re)connect.
        prompt: 'consent',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return u.toString();
    },
    async exchange(code, codeVerifier): Promise<OAuthTokens> {
      const t = await tokenRequest({ code, code_verifier: codeVerifier, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }, 'oauth_failed');
      if (typeof t.access_token !== 'string') throw new GmailError('oauth_failed', 'token response without access token');
      return {
        accessToken: t.access_token,
        expiresIn: Number(t.expires_in) || 3600,
        refreshToken: typeof t.refresh_token === 'string' ? t.refresh_token : undefined,
        scope: typeof t.scope === 'string' ? t.scope : undefined,
      };
    },
    async refresh(refreshToken) {
      const t = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }, 'reconnect');
      if (typeof t.access_token !== 'string') throw new GmailError('unavailable', 'refresh response without access token');
      return { accessToken: t.access_token, expiresIn: Number(t.expires_in) || 3600 };
    },
    async revoke(token) {
      await fetchImpl(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => undefined);
    },
  };
}

/** Maps a non-OK Gmail API response for read calls. 401 → reconnect (the adapter refreshes once). */
async function readError(res: Response, what: string): Promise<GmailError> {
  const code = await errorCodeOf(res);
  if (res.status === 401) return new GmailError('reconnect', `${what} 401`);
  if (res.status === 429 || /rateLimit/i.test(code)) return new GmailError('rate_limit', `${what} ${res.status} ${code}`);
  if (res.status === 403) return new GmailError('reconnect', `${what} 403 ${code}`);
  if (res.status >= 500) return new GmailError('unavailable', `${what} ${res.status}`);
  return new GmailError('rejected', `${what} ${res.status} ${code}`);
}

export function createGmailRestApi(fetchImpl: Fetch = fetch, options: { sendTimeoutMs?: number; readTimeoutMs?: number } = {}): GmailApi {
  const sendTimeoutMs = options.sendTimeoutMs ?? 30_000;
  const readTimeoutMs = options.readTimeoutMs ?? 20_000;

  async function get<T>(token: string, path: string, what: string): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${GMAIL_API}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(readTimeoutMs) });
    } catch {
      throw new GmailError('unavailable', `${what} unreachable`);
    }
    if (!res.ok) throw await readError(res, what);
    return (await res.json()) as T;
  }

  return {
    async profile(token) {
      const p = await get<{ emailAddress?: string }>(token, '/profile', 'profile');
      if (!p.emailAddress) throw new GmailError('oauth_failed', 'profile without email');
      return { email: p.emailAddress.toLowerCase() };
    },

    async send(token, raw, mail) {
      let res: Response;
      try {
        res = await fetchImpl(`${GMAIL_API}/messages/send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          // A follow up names the existing thread; Gmail also checks its In-Reply-To/References and Subject.
          body: JSON.stringify(mail.thread ? { raw: toBase64Url(raw), threadId: mail.thread.threadId } : { raw: toBase64Url(raw) }),
          signal: AbortSignal.timeout(sendTimeoutMs),
        });
      } catch {
        // Timeout or connection loss after the request may have reached Gmail: outcome unknown.
        throw new GmailError('ambiguous', 'send request did not complete');
      }
      if (res.ok) {
        const m = (await res.json().catch(() => null)) as { id?: string; threadId?: string } | null;
        if (!m?.id || !m.threadId) throw new GmailError('ambiguous', 'send response without ids');
        // Gmail accepted it; a different thread is recorded as Gmail reports it (never resent).
        if (mail.thread && m.threadId !== mail.thread.threadId) console.warn('[gmail] follow up was placed in a different thread by Gmail');
        return { messageId: m.id, threadId: m.threadId };
      }
      const code = await errorCodeOf(res);
      // 5xx: Gmail may or may not have processed it → never assume either way.
      if (res.status >= 500) throw new GmailError('ambiguous', `send ${res.status}`);
      if (res.status === 401) throw new GmailError('reconnect', 'send 401');
      if (res.status === 429 || /rateLimit/i.test(code)) throw new GmailError('rate_limit', `send ${res.status} ${code}`);
      if (res.status === 403 && /insufficient|scope/i.test(code)) throw new GmailError('reconnect', `send 403 ${code}`);
      throw new GmailError('rejected', `send ${res.status} ${code}`);
    },

    async rfcMessageId(token, messageId) {
      const m = await get<ApiMessage>(token, `/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Message-ID`, 'message');
      return header(m.payload, 'Message-ID');
    },

    async findSent(token, { sendId, recipient, after }): Promise<SentRef | null> {
      const since = Math.floor(new Date(after).getTime() / 1000) - 300;
      const q = `in:sent to:${recipient} after:${since}`;
      const list = await get<{ messages?: { id: string; threadId: string }[] }>(token, `/messages?maxResults=20&q=${encodeURIComponent(q)}`, 'search');
      for (const ref of list.messages ?? []) {
        const m = await get<ApiMessage>(token, `/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=X-KITE-Send-Id&metadataHeaders=Message-ID`, 'message');
        if (header(m.payload, 'X-KITE-Send-Id') === sendId) return { messageId: m.id, threadId: m.threadId, rfcMessageId: header(m.payload, 'Message-ID') };
      }
      return null;
    },

    async getThread(token, threadId) {
      let t: { messages?: ApiMessage[] };
      try {
        t = await get<{ messages?: ApiMessage[] }>(token, `/threads/${encodeURIComponent(threadId)}?format=full`, 'thread');
      } catch (e) {
        // A thread deleted in Gmail has nothing new to synchronize.
        if (e instanceof GmailError && e.code === 'rejected' && /thread 404/.test(e.detail)) return [];
        throw e;
      }
      return (t.messages ?? []).map(normalizeApiMessage);
    },
  };
}
