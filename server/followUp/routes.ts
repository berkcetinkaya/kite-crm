// Follow up API (Phase 7). Every mutation returns the fresh overview so the browser never guesses.
//   GET  /api/follow-ups                                  overview (settings, sequences, candidates) + follow up drafts
//   PUT  /api/follow-ups/settings                         Takip Sistemi Aktif, delays, max steps
//   POST /api/follow-ups/plans                            "Takip Planı Oluştur" for an eligible first contact
//   POST /api/follow-ups/steps/:id/prepare                "Takip Taslağını Hazırla" (the only generation call)
//   POST /api/follow-ups/steps/:id/save                   Kaydet (body only)
//   POST /api/follow-ups/steps/:id/approve                Onayla (never sends)
//   POST /api/follow-ups/steps/:id/postpone               Ertele { dueAt }
//   POST /api/follow-ups/steps/:id/skip                   Adımı Atla (nothing is sent)
//   POST /api/follow-ups/steps/:id/send                   explicit send confirmation { idempotencyKey }
//   POST /api/follow-ups/sequences/:id/stop               Takibi Durdur { reason }
//   POST /api/follow-ups/sequences/:id/resume             Takibi Sürdür
//
// Mutating calls must be same-origin JSON requests (same rule as the Gmail routes).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAIL_ERROR_MESSAGES, type MailErrorCode } from '../../src/domain/mail/api';
import { MAX_DELAY_DAYS, MAX_FOLLOW_UP_STEPS, MIN_DELAY_DAYS } from '../../src/domain/followUp';
import { abortOnClose, readJson, sendJson } from '../http';
import { MailSafetyError } from '../mail/generate';
import { DataError, arr, bool, id, isoDate, nullable, num, obj, parse, str, type Validator } from '../persistence/schema';
import { ProviderError } from '../research/provider';
import { RequestValidationError } from '../research/validateRequest';
import { OutreachError, type OutreachService } from '../outreach/service';
import { FollowUpError, type FollowUpPlanner } from './service';

const STEP = '(fst_[A-Za-z0-9_]{1,80})';
const SEQ = '(fus_[A-Za-z0-9_]{1,80})';

const idempotencyKey: Validator<string> = (v, p) => {
  const s = str(80, { min: 16 })(v, p);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new DataError('invalid_request', 'Gönderilen bilgiler geçersiz.', `${p}: invalid key`);
  return s;
};

const delay = num(MIN_DELAY_DAYS, MAX_DELAY_DAYS, { int: true });
const settingsBody = obj({
  settings: obj({
    enabled: bool,
    maxSteps: num(1, MAX_FOLLOW_UP_STEPS, { int: true }),
    delays: (v, p) => {
      const list = arr(delay, 3)(v, p);
      if (list.length !== 3) throw new DataError('invalid_request', 'Gönderilen bilgiler geçersiz.', `${p}: three delays required`);
      return list as [number, number, number];
    },
  }),
});
const bodyText = obj({ body: str(10_000, { min: 1, trim: false }) });

const MAIL_HTTP: Partial<Record<MailErrorCode, number>> = { not_configured: 503, rate_limit: 429, busy: 429, auth: 502, unavailable: 503, timeout: 504, invalid_response: 502, provider_rejected: 502, refused: 502 };

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

export function createFollowUpRoutes(planner: FollowUpPlanner | null, outreach: OutreachService | null, options: { maxBodyBytes: number }) {
  const OWNED = /^\/api\/follow-ups(\/|$)/;

  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;
    if (!OWNED.test(pathname)) return false;
    if (!planner || !outreach) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; takip işlemleri yapılamaz.' } });
      return true;
    }
    const p = planner;
    const method = req.method ?? 'GET';
    if (method !== 'GET' && !sameOriginJson(req)) {
      sendJson(res, 403, { error: { code: 'invalid_request', message: 'Bu işlem yalnızca KITE arayüzünden yapılabilir.' } });
      return true;
    }
    const body = async <T,>(validator: Validator<T>) => parse(validator, await readJson(req, options.maxBodyBytes));
    const state = () => ({ overview: p.overview(), drafts: p.drafts() });
    const done = (extra: Record<string, unknown> = {}) => sendJson(res, 200, { ...extra, ...state() });

    try {
      if (pathname === '/api/follow-ups' && method === 'GET') return void sendJson(res, 200, state()), true;
      if (pathname === '/api/follow-ups/settings' && method === 'PUT') {
        const { settings } = await body(settingsBody);
        p.saveSettings(settings);
        return void done(), true;
      }
      if (pathname === '/api/follow-ups/plans' && method === 'POST') {
        const { companyId } = await body(obj({ companyId: id }));
        return void done({ sequence: p.createPlan(companyId) }), true;
      }

      const step = pathname.match(new RegExp(`^/api/follow-ups/steps/${STEP}/(prepare|save|approve|postpone|skip|send)$`));
      if (step && method === 'POST') {
        const [, stepId, action] = step;
        switch (action) {
          case 'prepare': {
            await body(obj({}));
            const controller = abortOnClose(req, res);
            const r = await p.prepare(stepId, controller.signal);
            return void done({ sequence: r.sequence, draft: r.draft }), true;
          }
          case 'save': {
            const r = p.saveDraft(stepId, (await body(bodyText)).body);
            return void done({ sequence: r.sequence, draft: r.draft }), true;
          }
          case 'approve': {
            const r = p.approveDraft(stepId, (await body(bodyText)).body);
            return void done({ sequence: r.sequence, draft: r.draft }), true;
          }
          case 'postpone': {
            const { dueAt } = await body(obj({ dueAt: isoDate }));
            return void done({ sequence: p.postpone(stepId, dueAt) }), true;
          }
          case 'skip':
            await body(obj({}));
            return void done({ sequence: p.skip(stepId) }), true;
          case 'send': {
            const { idempotencyKey: key } = await body(obj({ idempotencyKey }));
            // Not aborted on disconnect: once submitted, the outcome must be recorded.
            const r = await outreach.sendFollowUp({ stepId, idempotencyKey: key });
            return void done({ send: r.send, company: r.company, replayed: r.replayed }), true;
          }
        }
      }

      const seq = pathname.match(new RegExp(`^/api/follow-ups/sequences/${SEQ}/(stop|resume)$`));
      if (seq && method === 'POST') {
        const [, sequenceId, action] = seq;
        if (action === 'stop') {
          const { reason } = await body(obj({ reason: nullable(str(300)) }));
          return void done({ sequence: p.stop(sequenceId, reason) }), true;
        }
        await body(obj({}));
        return void done({ sequence: p.resume(sequenceId) }), true;
      }

      sendJson(res, 404, { error: { code: 'not_found', message: 'İstenen işlem bulunamadı.' } });
    } catch (e) {
      if (res.writableEnded || res.destroyed) return true;
      // Error responses carry the fresh state too, so the screen reflects e.g. a newly found reply.
      const fresh = (() => {
        try {
          return state();
        } catch {
          return {};
        }
      })();
      if (e instanceof FollowUpError || e instanceof OutreachError) {
        sendJson(res, e.status, { error: { code: e.code, message: e.message }, ...e.extra, ...fresh });
      } else if (e instanceof MailSafetyError) {
        console.warn('[followup] draft rejected by safety rules:', e.problems.join(' | '));
        sendJson(res, 422, { error: { code: 'unsafe_output', message: MAIL_ERROR_MESSAGES.unsafe_output, problems: e.problems }, ...fresh });
      } else if (e instanceof ProviderError) {
        const code = (e.code in MAIL_ERROR_MESSAGES ? e.code : 'internal') as MailErrorCode;
        console.warn(`[followup] generation failed: ${e.code}`);
        sendJson(res, MAIL_HTTP[code] ?? 500, { error: { code, message: MAIL_ERROR_MESSAGES[code] }, ...fresh });
      } else if (e instanceof DataError) {
        sendJson(res, e.code === 'not_found' ? 404 : e.code === 'conflict' ? 409 : 400, { error: { code: e.code, message: e.userMessage } });
      } else if (e instanceof RequestValidationError) {
        sendJson(res, 400, { error: { code: 'invalid_request', message: 'Gönderilen bilgiler geçersiz.' } });
      } else {
        // Never log request bodies or mail content.
        console.error(`[followup] ${method} ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendJson(res, 500, { error: { code: 'storage_error', message: 'İşlem tamamlanamadı. Lütfen tekrar dene.' } });
      }
    }
    return true;
  };
}
