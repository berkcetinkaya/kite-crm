// Real Gmail integration code (OAuth + REST + credential store) against FAKE HTTP responses only.
// No request leaves the process; fake credentials must never appear in logs.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGmailAdapter, GMAIL_SCOPES } from './adapter';
import { createFileCredentialStore, CredentialError, parseCredentialsKey } from './credentialStore';
import { createGmailRestApi, createGoogleOAuthClient, GMAIL_API, GOOGLE_AUTH_URL, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL } from './google';
import { buildMime, fromBase64Url, normalizeApiMessage } from './message';
import { GmailError } from './types';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const CLIENT = { clientId: 'kite-test-client.apps.googleusercontent.com', clientSecret: 'kite-test-client-secret', redirectUri: 'http://localhost:5173/api/gmail/oauth/callback' };
const SECRETS = [/fake-refresh/, /fake-access/, /kite-test-client-secret/];

let dir: string;
let logs: string[];
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'kite-gmail-'));
  logs = [];
  for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
});
afterEach(() => {
  // No fake credential may ever reach a log line.
  for (const line of logs) for (const s of SECRETS) expect(line).not.toMatch(s);
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

interface FakeGoogle {
  fetch: typeof fetch;
  calls: { url: string; method: string; body: string; auth: string | null }[];
  revoked: Set<string>;
  sendResponse: () => Response | Promise<Response>;
  verifierFor: Map<string, string>;
  tokenOverrides: Record<string, unknown>;
  apiStatus: number | null;
}

function fakeGoogle(): FakeGoogle {
  let n = 0;
  const g: FakeGoogle = {
    calls: [],
    revoked: new Set(),
    verifierFor: new Map(),
    tokenOverrides: {},
    apiStatus: null,
    sendResponse: () => Response.json({ id: 'msg-1', threadId: 'thr-1', labelIds: ['SENT'] }),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? null;
      g.calls.push({ url, method, body, auth });
      if (url === GOOGLE_TOKEN_URL) {
        const f = new URLSearchParams(body);
        expect(f.get('client_secret')).toBe(CLIENT.clientSecret);
        if (f.get('grant_type') === 'authorization_code') {
          if (f.get('code') !== 'good-code') return Response.json({ error: 'invalid_grant' }, { status: 400 });
          g.verifierFor.set('last', f.get('code_verifier') ?? '');
          expect(f.get('redirect_uri')).toBe(CLIENT.redirectUri);
          return Response.json({ access_token: `fake-access-${++n}`, expires_in: 3599, refresh_token: 'fake-refresh-1', scope: GMAIL_SCOPES.join(' '), token_type: 'Bearer', ...g.tokenOverrides });
        }
        if (f.get('grant_type') === 'refresh_token') {
          if (g.revoked.has(f.get('refresh_token') ?? '')) return Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 });
          return Response.json({ access_token: `fake-access-${++n}`, expires_in: 3599, token_type: 'Bearer' });
        }
      }
      if (url === GOOGLE_REVOKE_URL) {
        g.revoked.add(new URLSearchParams(body).get('token') ?? '');
        return new Response(null, { status: 200 });
      }
      if (url.startsWith(GMAIL_API)) {
        if (g.apiStatus) {
          const s = g.apiStatus;
          g.apiStatus = null;
          return Response.json({ error: { code: s, status: 'UNAUTHENTICATED' } }, { status: s });
        }
        if (!auth?.startsWith('Bearer fake-access-')) return Response.json({ error: { code: 401 } }, { status: 401 });
        const p = url.slice(GMAIL_API.length);
        if (p === '/profile') return Response.json({ emailAddress: 'Berk@Kite-Growth.example', messagesTotal: 1 });
        if (p === '/messages/send') return g.sendResponse();
        if (p.startsWith('/messages?')) return Response.json({ messages: [{ id: 'msg-a', threadId: 'thr-a' }, { id: 'msg-1', threadId: 'thr-1' }] });
        if (p.startsWith('/messages/msg-a')) return Response.json({ id: 'msg-a', threadId: 'thr-a', payload: { headers: [{ name: 'X-KITE-Send-Id', value: 'snd_other' }] } });
        if (p.startsWith('/messages/msg-1')) return Response.json({ id: 'msg-1', threadId: 'thr-1', payload: { headers: [{ name: 'Message-ID', value: '<abc@mail.gmail.com>' }, { name: 'X-KITE-Send-Id', value: 'snd_1' }] } });
        if (p.startsWith('/threads/missing')) return Response.json({ error: { code: 404 } }, { status: 404 });
        if (p.startsWith('/threads/thr-1')) return Response.json(threadFixture());
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    }) as typeof fetch,
  };
  return g;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
function threadFixture() {
  return {
    id: 'thr-1',
    messages: [
      { id: 'msg-1', threadId: 'thr-1', labelIds: ['SENT'], internalDate: '1790000000000', snippet: 'İlk mail', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Berk <berk@kite-growth.example>' }, { name: 'To', value: 'ece@klinik.example' }, { name: 'Subject', value: 'Merhaba' }], body: { data: b64('İlk mail') } } },
      {
        id: 'msg-2',
        threadId: 'thr-1',
        labelIds: ['INBOX'],
        internalDate: '1790003600000',
        snippet: 'Te&#351;ekk&uuml;rler &amp; selam',
        payload: {
          mimeType: 'multipart/mixed',
          headers: [{ name: 'From', value: '"Dr. Ece Aydın" <Ece@Klinik.example>' }, { name: 'To', value: 'Berk <berk@kite-growth.example>, ops@kite-growth.example' }, { name: 'Subject', value: 'Re: Merhaba' }, { name: 'Message-ID', value: '<r1@klinik.example>' }],
          parts: [
            { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<div>Teşekkürler &amp; selam<script>alert(1)</script><br>Ece</div>') } }] },
            { mimeType: 'application/pdf', filename: 'teklif.pdf', body: { attachmentId: 'att-1', size: 1200 } },
          ],
        },
      },
    ],
  };
}

function adapterWith(g: FakeGoogle, options: { key?: string | null; now?: () => number } = {}) {
  const file = path.join(dir, 'gmail-credentials.enc');
  const credentials = createFileCredentialStore(file, options.key === undefined ? KEY : options.key);
  const adapter = createGmailAdapter({
    kind: 'gmail',
    configured: true,
    oauth: createGoogleOAuthClient(CLIENT, g.fetch),
    api: createGmailRestApi(g.fetch),
    credentials,
    now: options.now,
  });
  return { adapter, file, credentials };
}

async function connect(adapter: ReturnType<typeof adapterWith>['adapter']) {
  const { authUrl, state } = adapter.beginAuthorization();
  await adapter.completeAuthorization({ code: 'good-code', state });
  return authUrl;
}

describe('OAuth', () => {
  it('builds the authorization URL with minimal scopes, offline access, state and PKCE S256', async () => {
    const g = fakeGoogle();
    const { adapter } = adapterWith(g);
    const { authUrl, state } = adapter.beginAuthorization();
    const u = new URL(authUrl);
    expect(`${u.origin}${u.pathname}`).toBe(GOOGLE_AUTH_URL);
    const q = u.searchParams;
    expect(q.get('client_id')).toBe(CLIENT.clientId);
    expect(q.get('redirect_uri')).toBe(CLIENT.redirectUri);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly');
    expect(q.get('scope')).not.toMatch(/modify|mail\.google\.com|compose/);
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('state')).toBe(state);
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.has('client_secret')).toBe(false);
    await adapter.completeAuthorization({ code: 'good-code', state });
    const verifier = g.verifierFor.get('last')!;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(q.get('code_challenge'));
  });

  it('callback success stores an encrypted credential and reports the account', async () => {
    const g = fakeGoogle();
    const { adapter, file } = adapterWith(g);
    await connect(adapter);
    expect(await adapter.connection()).toMatchObject({ state: 'connected', email: 'berk@kite-growth.example' });
    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).not.toContain('fake-refresh');
    expect(onDisk).not.toContain('berk@kite-growth.example');
    expect(JSON.parse(onDisk)).toMatchObject({ v: 1, alg: 'A256GCM' });
  });

  it('rejects unknown, reused, expired and unbound states, denial, missing refresh token and missing scopes', async () => {
    let t = 1_000_000;
    const g = fakeGoogle();
    const { adapter } = adapterWith(g, { now: () => t });
    const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e as GmailError).code);
    expect(await code(adapter.completeAuthorization({ code: 'good-code', state: 'forged' }))).toBe('oauth_state');
    const a = adapter.beginAuthorization();
    expect(await code(adapter.completeAuthorization({ code: 'good-code', state: a.state, stateBound: false }))).toBe('oauth_state');
    expect(await code(adapter.completeAuthorization({ code: 'good-code', state: a.state }))).toBe('oauth_state');
    const b = adapter.beginAuthorization();
    t += 11 * 60_000;
    expect(await code(adapter.completeAuthorization({ code: 'good-code', state: b.state }))).toBe('oauth_state');
    const c = adapter.beginAuthorization();
    expect(await code(adapter.completeAuthorization({ error: 'access_denied', state: c.state }))).toBe('oauth_denied');
    const d = adapter.beginAuthorization();
    expect(await code(adapter.completeAuthorization({ code: 'bad-code', state: d.state }))).toBe('oauth_failed');
    g.tokenOverrides = { refresh_token: undefined };
    const e = adapter.beginAuthorization();
    expect(await code(adapter.completeAuthorization({ code: 'good-code', state: e.state }))).toBe('oauth_failed');
    g.tokenOverrides = { scope: 'https://www.googleapis.com/auth/gmail.send' };
    const f = adapter.beginAuthorization();
    expect(await code(adapter.completeAuthorization({ code: 'good-code', state: f.state }))).toBe('oauth_denied');
    expect(await adapter.connection()).toMatchObject({ state: 'disconnected' });
  });

  it('refreshes an expired access token and retries a 401 once', async () => {
    let t = 1_000_000;
    const g = fakeGoogle();
    const { adapter } = adapterWith(g, { now: () => t });
    await connect(adapter);
    const tokenCalls = () => g.calls.filter((c) => c.url === GOOGLE_TOKEN_URL).length;
    expect(tokenCalls()).toBe(1);
    await adapter.getThread('thr-1');
    expect(tokenCalls()).toBe(1); // cached access token
    t += 2 * 3_600_000;
    await adapter.getThread('thr-1');
    expect(tokenCalls()).toBe(2); // expired → refreshed
    g.apiStatus = 401;
    await adapter.getThread('thr-1');
    expect(tokenCalls()).toBe(3); // 401 → one refresh + retry
  });

  it('a revoked grant shows "reconnect" and blocks sending before anything is submitted', async () => {
    let t = 1_000_000;
    const g = fakeGoogle();
    const { adapter } = adapterWith(g, { now: () => t });
    await connect(adapter);
    g.revoked.add('fake-refresh-1');
    t += 2 * 3_600_000;
    expect(await adapter.verify()).toMatchObject({ state: 'error', error: 'reconnect', email: 'berk@kite-growth.example' });
    await expect(adapter.send({ sendId: 'snd_1', to: { email: 'a@b.example', name: null }, subject: 's', body: 'b' })).rejects.toMatchObject({ code: 'reconnect' });
    expect(g.calls.some((c) => c.url.endsWith('/messages/send'))).toBe(false);
  });

  it('disconnect revokes the grant at Google and deletes the credential file', async () => {
    const g = fakeGoogle();
    const { adapter, file } = adapterWith(g);
    await connect(adapter);
    expect(existsSync(file)).toBe(true);
    await adapter.disconnect();
    expect(g.revoked.has('fake-refresh-1')).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(await adapter.connection()).toMatchObject({ state: 'disconnected', email: null });
  });
});

describe('credential store', () => {
  it('fails safely with a missing, invalid or wrong key and with a tampered file', async () => {
    const file = path.join(dir, 'c.enc');
    const cred = { provider: 'gmail' as const, email: 'berk@x.example', refreshToken: 'fake-refresh-x', scope: 's', connectedAt: '2026-10-05T10:00:00.000Z' };
    await expect(createFileCredentialStore(file, null).write(cred)).rejects.toBeInstanceOf(CredentialError);
    await expect(createFileCredentialStore(file, 'too-short').write(cred)).rejects.toMatchObject({ code: 'key_missing' });
    await createFileCredentialStore(file, KEY).write(cred);
    expect(await createFileCredentialStore(file, KEY).read()).toEqual(cred);
    await expect(createFileCredentialStore(file, OTHER_KEY).read()).rejects.toMatchObject({ code: 'unreadable' });
    await expect(createFileCredentialStore(file, null).read()).rejects.toMatchObject({ code: 'key_missing' });
    const env = JSON.parse(readFileSync(file, 'utf8'));
    env.ct = Buffer.from('tampered').toString('base64');
    writeFileSync(file, JSON.stringify(env));
    await expect(createFileCredentialStore(file, KEY).read()).rejects.toMatchObject({ code: 'unreadable' });
    await createFileCredentialStore(file, KEY).delete();
    expect(await createFileCredentialStore(file, KEY).read()).toBeNull();
  });

  it('accepts 32-byte base64 or hex keys only', () => {
    expect(parseCredentialsKey(KEY)?.length).toBe(32);
    expect(parseCredentialsKey('ab'.repeat(32))?.length).toBe(32);
    expect(parseCredentialsKey('a'.repeat(20))).toBeNull();
    expect(parseCredentialsKey(Buffer.alloc(16).toString('base64'))).toBeNull();
  });

  it('the adapter reports a missing or wrong key as a connection error, not as connected', async () => {
    const g = fakeGoogle();
    const first = adapterWith(g);
    await connect(first.adapter);
    expect(await adapterWith(g, { key: null }).adapter.connection()).toMatchObject({ state: 'error', error: 'key_missing' });
    expect(await adapterWith(g, { key: OTHER_KEY }).adapter.connection()).toMatchObject({ state: 'error', error: 'unreadable' });
  });
});

describe('Gmail REST', () => {
  async function connected(g = fakeGoogle()) {
    const { adapter } = adapterWith(g);
    await connect(adapter);
    return { g, adapter };
  }
  const mail = { sendId: 'snd_1', to: { email: 'ece@klinik.example', name: 'Dr. Ece Aydın' }, subject: 'Randevu takibi\r\nBcc: evil@x.example', body: 'Merhaba Ece Hanım,\nÇok kısa bir öneri.' };

  it('sends a plain text UTF-8 message with the KITE send id and returns Gmail ids', async () => {
    const { g, adapter } = await connected();
    const ref = await adapter.send(mail);
    expect(ref).toEqual({ messageId: 'msg-1', threadId: 'thr-1', rfcMessageId: '<abc@mail.gmail.com>' });
    const sendCall = g.calls.find((c) => c.url.endsWith('/messages/send'))!;
    const raw = fromBase64Url(JSON.parse(sendCall.body).raw);
    expect(raw).toContain('X-KITE-Send-Id: snd_1');
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).toMatch(/^To: =\?UTF-8\?B\?.+\?= <ece@klinik\.example>$/m);
    // Header injection: the line break in the subject cannot create a Bcc header.
    expect(raw).not.toMatch(/^Bcc:/m);
    const bodyB64 = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(bodyB64, 'base64').toString('utf8')).toBe('Merhaba Ece Hanım,\r\nÇok kısa bir öneri.');
  });

  it('classifies send outcomes: 4xx rejected, 429 rate limit, 5xx/timeout/missing ids ambiguous', async () => {
    const { g, adapter } = await connected();
    const outcome = async (r: () => Response | Promise<Response>) => {
      g.sendResponse = r;
      return adapter.send(mail).then(() => 'sent', (e) => (e as GmailError).code);
    };
    expect(await outcome(() => Response.json({ error: { code: 400, status: 'INVALID_ARGUMENT', errors: [{ reason: 'invalidArgument' }] } }, { status: 400 }))).toBe('rejected');
    expect(await outcome(() => Response.json({ error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } }, { status: 429 }))).toBe('rate_limit');
    expect(await outcome(() => Response.json({ error: { code: 500 } }, { status: 500 }))).toBe('ambiguous');
    expect(await outcome(() => Response.json({ error: { code: 503 } }, { status: 503 }))).toBe('ambiguous');
    expect(await outcome(() => Response.json({ labelIds: ['SENT'] }))).toBe('ambiguous');
    expect(
      await outcome(() => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }),
    ).toBe('ambiguous');
    // None of these was retried: one submission per attempt.
    expect(g.calls.filter((c) => c.url.endsWith('/messages/send'))).toHaveLength(6);
  });

  it('finds a sent message by its KITE send id (reconciliation)', async () => {
    const { adapter } = await connected();
    expect(await adapter.findSent({ sendId: 'snd_1', recipient: 'ece@klinik.example', after: '2026-10-05T10:00:00.000Z' })).toEqual({ messageId: 'msg-1', threadId: 'thr-1', rfcMessageId: '<abc@mail.gmail.com>' });
    expect(await adapter.findSent({ sendId: 'snd_none', recipient: 'ece@klinik.example', after: '2026-10-05T10:00:00.000Z' })).toBeNull();
  });

  it('normalizes thread messages to plain text and metadata; a deleted thread is empty', async () => {
    const { adapter } = await connected();
    const [own, reply] = await adapter.getThread('thr-1');
    expect(own.labelIds).toContain('SENT');
    expect(reply).toMatchObject({
      id: 'msg-2',
      rfcMessageId: '<r1@klinik.example>',
      from: { email: 'ece@klinik.example', name: 'Dr. Ece Aydın' },
      to: ['berk@kite-growth.example', 'ops@kite-growth.example'],
      subject: 'Re: Merhaba',
      snippet: 'Teşekkürler & selam',
      attachments: [{ filename: 'teklif.pdf', mimeType: 'application/pdf', size: 1200 }],
    });
    expect(reply.bodyText).toBe('Teşekkürler & selam\nEce');
    expect(reply.bodyText).not.toContain('alert');
    expect(await adapter.getThread('missing')).toEqual([]);
  });

  it('builds MIME without a From header when the account is unknown', () => {
    expect(buildMime({ ...mail, subject: 'Konu' }, null)).not.toMatch(/^From:/m);
    expect(normalizeApiMessage({ id: 'x', threadId: 't' }).messageAt).toBe(new Date(0).toISOString());
  });
});
