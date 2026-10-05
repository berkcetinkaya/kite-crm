// Gmail + outreach API (Phase 6). Tokens never appear in any response, redirect or log.
//   GET  /api/gmail/status                         connection state (account email, last sync)
//   POST /api/gmail/verify                         re-check the grant with Google ("Bağlantıyı Yenile")
//   POST /api/gmail/connect                        start OAuth → { authUrl } (+ state cookie)
//   GET  /api/gmail/oauth/callback                 OAuth redirect target → back to Ayarlar
//   POST /api/gmail/disconnect                     revoke + delete the stored credential
//   GET  /api/outreach                             send records and thread messages
//   POST /api/outreach/send                        send ONE approved draft (explicit confirmation)
//   POST /api/outreach/sends/:id/reconcile         look an unclear send up in Gmail
//   POST /api/outreach/sends/:id/mark-not-sent     Berk confirms an unclear send did not go out
//   POST /api/outreach/sync                        "Yanıtları Kontrol Et"
//
// Mutating calls must be same-origin JSON requests: a cross-site form or no-cors fetch cannot send
// mail or change the connection (no authentication exists yet, so this matters).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http';
import { RequestValidationError } from '../research/validateRequest';
import { DataError, id, obj, parse, str, type Validator } from '../persistence/schema';
import { OutreachError, type OutreachService } from './service';

const COOKIE = 'kite_gmail_oauth';
const COOKIE_PATH = '/api/gmail/oauth';
const SEND_ID = '(snd_[A-Za-z0-9_]{1,80})';

const idempotencyKey: Validator<string> = (v, p) => {
  const s = str(80, { min: 16 })(v, p);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new DataError('invalid_request', 'Gönderilen bilgiler geçersiz.', `${p}: invalid key`);
  return s;
};

const sendBody = obj({ draftId: id, companyId: id, contactId: id, idempotencyKey });

function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Same-origin JSON only for POSTs (blocks cross-site forms and simple cross-origin requests). */
function sameOriginJson(req: IncomingMessage): boolean {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function createOutreachRoutes(service: OutreachService | null, options: { maxBodyBytes: number; secureCookie: boolean }) {
  const OWNED = /^\/api\/(gmail|outreach)(\/|$)/;

  function sendError(res: ServerResponse, e: OutreachError) {
    sendJson(res, e.status, { error: { code: e.code, message: e.message }, ...e.extra });
  }

  function redirect(res: ServerResponse, location: string, clearCookie: boolean) {
    const headers: Record<string, string | string[]> = { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    if (clearCookie) headers['set-cookie'] = `${COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax${options.secureCookie ? '; Secure' : ''}`;
    res.writeHead(302, headers);
    res.end();
  }

  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;
    if (!OWNED.test(pathname)) return false;
    if (!service) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; Gmail işlemleri yapılamaz.' } });
      return true;
    }
    const s = service;
    const method = req.method ?? 'GET';
    if (method === 'POST' && !sameOriginJson(req)) {
      sendJson(res, 403, { error: { code: 'invalid_request', message: 'Bu işlem yalnızca KITE arayüzünden yapılabilir.' } });
      return true;
    }
    const body = async <T,>(validator: Validator<T>) => parse(validator, await readJson(req, options.maxBodyBytes));

    try {
      // ---- Gmail connection ----
      if (pathname === '/api/gmail/status' && method === 'GET') return void sendJson(res, 200, await s.status()), true;
      if (pathname === '/api/gmail/verify' && method === 'POST') return void sendJson(res, 200, await s.verify()), true;
      if (pathname === '/api/gmail/disconnect' && method === 'POST') return void sendJson(res, 200, await s.disconnect()), true;
      if (pathname === '/api/gmail/connect' && method === 'POST') {
        const { authUrl, state } = s.beginConnect();
        res.setHeader('set-cookie', `${COOKIE}=${encodeURIComponent(state)}; Path=${COOKIE_PATH}; Max-Age=600; HttpOnly; SameSite=Lax${options.secureCookie ? '; Secure' : ''}`);
        sendJson(res, 200, { authUrl });
        return true;
      }
      if (pathname === '/api/gmail/oauth/callback' && method === 'GET') {
        const state = url.searchParams.get('state');
        // The state must come back to the same browser that started the flow (cookie) AND match
        // the server's single-use record (checked by the adapter).
        const bound = state !== null && cookieValue(req, COOKIE) === state;
        try {
          await s.completeConnect({ code: url.searchParams.get('code'), state, stateBound: bound, error: url.searchParams.get('error') });
          redirect(res, '/#/settings?gmail=connected', true);
        } catch (e) {
          const code = e instanceof OutreachError ? e.code : 'oauth_failed';
          if (e instanceof OutreachError) console.warn(`[gmail] oauth callback: ${code}${e.extra.detail ? ` (${String(e.extra.detail)})` : ''}`);
          else console.error('[gmail] oauth callback failed:', e instanceof Error ? e.message : e);
          redirect(res, `/#/settings?gmail=error&code=${encodeURIComponent(code)}`, true);
        }
        return true;
      }

      // ---- Outreach ----
      if (pathname === '/api/outreach' && method === 'GET') return void sendJson(res, 200, s.list()), true;
      if (pathname === '/api/outreach/send' && method === 'POST') {
        const request = await body(sendBody);
        // Deliberately NOT aborted when the browser disconnects: once submitted, the outcome must
        // be recorded, and aborting mid-request would only create an unclear send.
        return void sendJson(res, 200, await s.send(request)), true;
      }
      if (pathname === '/api/outreach/sync' && method === 'POST') return void sendJson(res, 200, await s.sync()), true;
      const reconcile = pathname.match(new RegExp(`^/api/outreach/sends/${SEND_ID}/reconcile$`));
      if (reconcile && method === 'POST') return void sendJson(res, 200, await s.reconcile(reconcile[1])), true;
      const notSent = pathname.match(new RegExp(`^/api/outreach/sends/${SEND_ID}/mark-not-sent$`));
      if (notSent && method === 'POST') return void sendJson(res, 200, { send: s.markNotSent(notSent[1]) }), true;

      sendJson(res, 404, { error: { code: 'not_found', message: 'İstenen işlem bulunamadı.' } });
    } catch (e) {
      if (res.writableEnded || res.destroyed) return true;
      if (e instanceof OutreachError) sendError(res, e);
      else if (e instanceof DataError) sendJson(res, e.code === 'not_found' ? 404 : e.code === 'conflict' ? 409 : 400, { error: { code: e.code, message: e.userMessage } });
      else if (e instanceof RequestValidationError) sendJson(res, 400, { error: { code: 'invalid_request', message: 'Gönderilen bilgiler geçersiz.' } });
      else {
        // Never log request bodies or Gmail content.
        console.error(`[outreach] ${method} ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendJson(res, 500, { error: { code: 'storage_error', message: 'İşlem tamamlanamadı. Lütfen tekrar dene.' } });
      }
    }
    return true;
  };
}
