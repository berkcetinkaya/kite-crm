// Deterministic fixture Gmail (no network, no Google account). It runs through the same adapter
// core as the real provider (state + PKCE, encrypted credential store, token refresh), so browser
// QA exercises the real connection logic with zero Gmail calls.
//
// Scenarios are chosen by the recipient address (case-insensitive substring):
//   "reject"    → Gmail rejects the message (nothing sent)
//   "ratelimit" → Gmail rate limit (nothing sent)
//   "timeout"   → request times out, but the message WAS delivered (reconcile finds it)
//   "lost"      → request times out and the message was NOT delivered
//   "replies"   → thread gets two replies and one more message from Berk's own account
//   "reply"     → thread gets one reply
//   anything else → sent, no reply
import { GMAIL_SCOPES, type GmailApi, type OAuthClient } from './adapter';
import { GmailError, type GmailThreadMessage, type OutgoingMail, type SentRef } from './types';

export const FIXTURE_ACCOUNT = 'berk@kite-fixture.example';
export const FIXTURE_AUTH_CODE = 'fixture-auth-code';

export interface FixtureControls {
  /** Number of send submissions that reached the fixture mailbox API (duplicate send detection). */
  sendCalls(): number;
  /** Simulates Berk revoking KITE's access in his Google account. */
  revokeExternally(): void;
  /** Messages actually delivered (what the "recipient" received). */
  delivered(): OutgoingMail[];
}

const pick = (email: string) => {
  const e = email.toLowerCase();
  if (e.includes('reject')) return 'reject';
  if (e.includes('ratelimit')) return 'ratelimit';
  if (e.includes('timeout')) return 'timeout';
  if (e.includes('lost')) return 'lost';
  if (e.includes('replies')) return 'replies';
  if (e.includes('reply')) return 'reply';
  return 'plain';
};

export function createFixtureGmail(options: { redirectUri: string; sendDelayMs?: number; now?: () => number }): { oauth: OAuthClient; api: GmailApi; controls: FixtureControls } {
  const now = () => options.now?.() ?? Date.now();
  const revoked = new Set<string>();
  const issuedRefresh = new Set<string>();
  const accessTokens = new Set<string>();
  let counter = 0;
  let sendCalls = 0;
  const delivered: OutgoingMail[] = [];
  const threads = new Map<string, GmailThreadMessage[]>();
  const sentBySendId = new Map<string, SentRef>();
  const nextId = (p: string) => `${p}${(++counter).toString(36).padStart(4, '0')}${now().toString(36)}`;

  const issueAccess = () => {
    const t = nextId('fixture-access-');
    accessTokens.add(t);
    return t;
  };
  const checkAccess = (token: string) => {
    if (!accessTokens.has(token)) throw new GmailError('reconnect', 'fixture 401');
  };

  const oauth: OAuthClient = {
    authUrl({ state, codeChallenge }) {
      // Real Google would show consent here; the fixture returns straight to KITE's callback.
      const u = new URL(options.redirectUri, 'http://kite.local');
      u.searchParams.set('code', FIXTURE_AUTH_CODE);
      u.searchParams.set('state', state);
      u.searchParams.set('fixture_challenge', codeChallenge.slice(0, 8));
      return options.redirectUri.startsWith('http') ? u.toString() : `${u.pathname}${u.search}`;
    },
    async exchange(code) {
      if (code !== FIXTURE_AUTH_CODE) throw new GmailError('oauth_failed', 'fixture invalid code');
      const refreshToken = nextId('fixture-refresh-');
      issuedRefresh.add(refreshToken);
      return { accessToken: issueAccess(), expiresIn: 3600, refreshToken, scope: GMAIL_SCOPES.join(' ') };
    },
    async refresh(refreshToken) {
      if (revoked.has(refreshToken) || !refreshToken.startsWith('fixture-refresh-')) throw new GmailError('reconnect', 'fixture invalid_grant');
      return { accessToken: issueAccess(), expiresIn: 3600 };
    },
    async revoke(token) {
      revoked.add(token);
    },
  };

  function reply(threadId: string, n: number, mail: OutgoingMail, at: number): GmailThreadMessage {
    const name = mail.to.name ?? 'Yetkili';
    return {
      id: `${threadId}-r${n}`,
      threadId,
      rfcMessageId: `<${threadId}-r${n}@recipient.example>`,
      labelIds: ['INBOX', 'UNREAD'],
      from: { email: mail.to.email.toLowerCase(), name },
      to: [FIXTURE_ACCOUNT],
      cc: [],
      subject: `Re: ${mail.subject}`,
      bodyText:
        n === 1
          ? `Merhaba Berk,\n\nMailiniz için teşekkürler. Önümüzdeki hafta kısa bir görüşme yapabiliriz. <b>HTML değil, düz metin.</b>\n\n${name}\n\n> ${mail.body.split('\n')[0]}`
          : `Bir ekleme: Salı öğleden sonra bize uygun.\n\n${name}`,
      snippet: n === 1 ? 'Mailiniz için teşekkürler. Önümüzdeki hafta kısa bir görüşme yapabiliriz.' : 'Bir ekleme: Salı öğleden sonra bize uygun.',
      messageAt: new Date(at + n * 3_600_000).toISOString(),
      attachments: n === 1 ? [{ filename: 'tanitim.pdf', mimeType: 'application/pdf', size: 48213 }] : [],
    };
  }

  function deliver(mail: OutgoingMail): SentRef {
    const threadId = nextId('fxthr');
    const messageId = nextId('fxmsg');
    const at = now();
    const own: GmailThreadMessage = {
      id: messageId,
      threadId,
      rfcMessageId: `<${messageId}@mail.gmail.com>`,
      labelIds: ['SENT'],
      from: { email: FIXTURE_ACCOUNT, name: 'Berk' },
      to: [mail.to.email.toLowerCase()],
      cc: [],
      subject: mail.subject,
      bodyText: mail.body,
      snippet: mail.body.slice(0, 120),
      messageAt: new Date(at).toISOString(),
      attachments: [],
    };
    const messages = [own];
    const scenario = pick(mail.to.email);
    if (scenario === 'reply' || scenario === 'replies') messages.push(reply(threadId, 1, mail, at));
    if (scenario === 'replies') {
      messages.push({ ...own, id: `${threadId}-own2`, rfcMessageId: `<${threadId}-own2@mail.gmail.com>`, subject: `Re: ${mail.subject}`, bodyText: 'Teşekkürler, takvim davetini gönderiyorum.', snippet: 'Teşekkürler, takvim davetini gönderiyorum.', messageAt: new Date(at + 2 * 3_600_000).toISOString() });
      messages.push(reply(threadId, 2, mail, at + 2 * 3_600_000));
    }
    threads.set(threadId, messages);
    delivered.push(mail);
    const ref = { messageId, threadId, rfcMessageId: own.rfcMessageId };
    sentBySendId.set(mail.sendId, ref);
    return ref;
  }

  const api: GmailApi = {
    async profile(token) {
      checkAccess(token);
      return { email: FIXTURE_ACCOUNT };
    },
    async send(token, _raw, mail) {
      checkAccess(token);
      sendCalls += 1;
      if (options.sendDelayMs) await new Promise((r) => setTimeout(r, options.sendDelayMs));
      const scenario = pick(mail.to.email);
      if (scenario === 'reject') throw new GmailError('rejected', 'fixture 400 invalidArgument');
      if (scenario === 'ratelimit') throw new GmailError('rate_limit', 'fixture 429');
      if (scenario === 'lost') throw new GmailError('ambiguous', 'fixture timeout (not delivered)');
      const ref = deliver(mail);
      if (scenario === 'timeout') throw new GmailError('ambiguous', 'fixture timeout (delivered)');
      return { messageId: ref.messageId, threadId: ref.threadId };
    },
    async rfcMessageId(token, messageId) {
      checkAccess(token);
      for (const msgs of threads.values()) for (const m of msgs) if (m.id === messageId) return m.rfcMessageId;
      return null;
    },
    async findSent(token, { sendId }) {
      checkAccess(token);
      return sentBySendId.get(sendId) ?? null;
    },
    async getThread(token, threadId) {
      checkAccess(token);
      // Unknown thread (e.g. fixture restarted): nothing new to synchronize.
      return (threads.get(threadId) ?? []).map((m) => ({ ...m }));
    },
  };

  return {
    oauth,
    api,
    controls: {
      sendCalls: () => sendCalls,
      revokeExternally: () => {
        // Every grant issued so far stops working (refresh and access tokens); a new connect works.
        for (const t of issuedRefresh) revoked.add(t);
        accessTokens.clear();
      },
      delivered: () => [...delivered],
    },
  };
}
