// Outreach preparation API (Phase 13). Nothing here sends email, approves a draft or plans follow ups.
//   GET  /api/outreach-prep                                    readiness of every CRM company + daily generation count
//   GET  /api/outreach-prep/:companyId                         readiness, preparation, draft
//   PUT  /api/outreach-prep/:companyId                         { patch }  contact, service, angle, tone, CTA, language, manual facts, "Farklı şirket"
//   POST /api/outreach-prep/:companyId/generate                { mode, variants?, replaceEdits? }
//   POST /api/outreach-prep/:companyId/variants/:id/use        { replaceEdits? }
//   POST /api/outreach-prep/batch                              { companyIds }  at most 5, sequential
// Mutating calls must be same-origin JSON.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAIL_ERROR_MESSAGES, type MailErrorCode } from '../../src/domain/mail/api';
import { CTA_KEYS, OUTREACH_TONES } from '../../src/domain/outreachAngles';
import { MAX_BATCH_PREPARE, type PreparationPatch } from '../../src/domain/outreachPrep';
import { SERVICE_KEYS } from '../../src/domain/services';
import { abortOnClose, readJson, sendJson } from '../http';
import { MailSafetyError } from '../mail/generate';
import { arr, bool, DataError, nullable, obj, oneOf, optional, parse, str, type Validator } from '../persistence/schema';
import { ProviderError } from '../research/provider';
import { RequestValidationError } from '../research/validateRequest';
import { OUTREACH_PREP_HTTP, OutreachPrepError, type OutreachPrepService } from './service';

const COMPANY_ID = '([A-Za-z0-9_]{3,80})';
const MAIL_HTTP: Partial<Record<MailErrorCode, number>> = { rate_limit: 429, busy: 429, auth: 502, unavailable: 503, timeout: 504, invalid_response: 502, provider_rejected: 502, refused: 502, not_configured: 503 };

const patchValidator: Validator<PreparationPatch> = obj({
  contactId: optional(nullable(str(80))),
  service: optional(nullable(oneOf(SERVICE_KEYS))),
  angleKey: optional(nullable(str(40))),
  tone: optional(oneOf(OUTREACH_TONES)),
  ctaKey: optional(nullable(oneOf(CTA_KEYS))),
  language: optional(nullable(oneOf(['tr', 'en'] as const))),
  manualFacts: optional(arr(obj({ id: str(60), text: str(300) }), 5)),
  duplicateAcks: optional(arr(str(120, { min: 1 }), 20)),
});

const generateValidator = obj({ mode: oneOf(['full', 'subject', 'opening', 'cta'] as const), variants: optional(bool), replaceEdits: optional(bool) });

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

export function createOutreachPrepRoutes(service: OutreachPrepService | null, options: { maxBodyBytes: number }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;
    if (!/^\/api\/outreach-prep(\/|$)/.test(pathname)) return false;
    if (!service) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; outreach hazırlığı yapılamaz.' } });
      return true;
    }
    const method = req.method ?? 'GET';
    if (method !== 'GET' && !sameOriginJson(req)) {
      sendJson(res, 403, { error: { code: 'invalid_request', message: 'Bu işlem yalnızca KITE arayüzünden yapılabilir.' } });
      return true;
    }
    const body = async <T,>(v: Validator<T>) => parse(v, await readJson(req, options.maxBodyBytes));
    const ok = (payload: unknown) => void sendJson(res, 200, payload);
    const m = (pattern: string) => pathname.match(new RegExp(`^/api/outreach-prep/${pattern}$`));
    let r: RegExpMatchArray | null;
    try {
      if (pathname === '/api/outreach-prep' && method === 'GET') return ok({ items: service.overview(), realGenerations: service.realGenerations() }), true;
      if (pathname === '/api/outreach-prep/batch' && method === 'POST') {
        const b = await body(obj({ companyIds: arr(str(80, { min: 3 }), MAX_BATCH_PREPARE + 5) }));
        const controller = abortOnClose(req, res);
        return ok({ results: await service.batch(b.companyIds, controller.signal) }), true;
      }
      if ((r = m(`${COMPANY_ID}/generate`)) && method === 'POST') {
        const b = await body(generateValidator);
        const controller = abortOnClose(req, res);
        return ok(await service.generate(r[1], b, controller.signal)), true;
      }
      if ((r = m(`${COMPANY_ID}/variants/([A-Za-z0-9_]{3,100})/use`)) && method === 'POST') {
        const b = await body(obj({ replaceEdits: optional(bool) }));
        return ok(service.useVariant(r[1], r[2], b.replaceEdits === true)), true;
      }
      if ((r = m(COMPANY_ID)) && method === 'GET') return ok(service.detail(r[1])), true;
      if ((r = m(COMPANY_ID)) && method === 'PUT') return ok(service.updatePreparation(r[1], (await body(obj({ patch: patchValidator }))).patch)), true;
      sendJson(res, 404, { error: { code: 'not_found', message: 'İstenen işlem bulunamadı.' } });
    } catch (e) {
      if (res.writableEnded || res.destroyed) return true;
      if (e instanceof OutreachPrepError) sendJson(res, OUTREACH_PREP_HTTP[e.code], { error: { code: e.code, message: e.message, ...(e.extra.reasons ? { reasons: e.extra.reasons } : {}) } });
      else if (e instanceof MailSafetyError) {
        console.warn('[outreach-prep] draft rejected by validation:', e.problems.join(' | '));
        sendJson(res, 422, { error: { code: 'unsafe_output', message: MAIL_ERROR_MESSAGES.unsafe_output, problems: e.problems } });
      } else if (e instanceof ProviderError) {
        const code = (e.code in MAIL_ERROR_MESSAGES ? e.code : 'internal') as MailErrorCode;
        console.warn(`[outreach-prep] generation failed: ${e.code}`);
        sendJson(res, MAIL_HTTP[code] ?? 500, { error: { code, message: MAIL_ERROR_MESSAGES[code] } });
      } else if (e instanceof DataError) sendJson(res, e.code === 'not_found' ? 404 : 400, { error: { code: e.code, message: e.userMessage } });
      else if (e instanceof RequestValidationError) sendJson(res, 400, { error: { code: 'invalid_request', message: 'Gönderilen bilgiler geçersiz.' } });
      else {
        // Never log request bodies (manual facts may contain customer details).
        console.error(`[outreach-prep] ${method} ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendJson(res, 500, { error: { code: 'storage_error', message: 'İşlem tamamlanamadı. Lütfen tekrar dene.' } });
      }
    }
    return true;
  };
}
