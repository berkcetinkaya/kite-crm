// Prospecting API (Phase 12): review layer over research candidates.
//   GET  /api/discovery/status                         { realRuns: { today, limit } }
//   GET  /api/discovery/jobs/:id                       run details + candidate views (duplicates, confidence, priority)
//   PUT  /api/discovery/candidates/:id/review          { review: patch }           reversible review decision / overrides
//   POST /api/discovery/candidates/:id/duplicate-ack   { key, confirmed }          "Farklı şirket" (probable matches only)
//   POST /api/discovery/candidates/:id/reresearch      {}                          explicit, one at a time
//   GET  /api/discovery/candidates/:id/versions        previous research snapshots (latest 3)
//   POST /api/discovery/bulk                           { resultIds, action }       safe bulk review (per-candidate results)
//   POST /api/discovery/convert                        { items: [{ resultId, services }] }  per-candidate transactions
// Mutating calls must be same-origin JSON. Nothing here sends email or creates outreach.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONTACT_PROVENANCES, REVIEW_STATUSES, type CandidateContact } from '../../src/domain/prospecting';
import { SERVICE_KEYS } from '../../src/domain/services';
import { readJson, sendJson } from '../http';
import { arr, bool, DataError, nullable, obj, oneOf, optional, parse, str, type Validator } from '../persistence/schema';
import { RequestValidationError } from '../research/validateRequest';
import { ProspectingError, type BulkAction, type DiscoveryServiceApi, type ReviewPatch } from './service';

const RESULT_ID = '(res_[A-Za-z0-9_]{1,80})';
const services = arr(oneOf(SERVICE_KEYS), SERVICE_KEYS.length);
const contact: Validator<CandidateContact> = obj({
  fullName: str(120, { min: 1 }),
  role: str(120),
  email: nullable(str(200)),
  phone: nullable(str(60)),
  provenance: oneOf(CONTACT_PROVENANCES),
  evidenceIds: arr(str(20), 20),
});
const reviewPatch: Validator<ReviewPatch> = obj({
  status: optional(oneOf(REVIEW_STATUSES)),
  rejectReason: optional(nullable(str(500))),
  notes: optional(str(4000)),
  sector: optional(nullable(str(120))),
  sectorId: optional(nullable(str(80))),
  services: optional(nullable(services)),
  contacts: optional(nullable(arr(contact, 20))),
});

function bulkAction(v: unknown, p: string): BulkAction {
  const o = (v ?? {}) as Record<string, unknown>;
  if (o.type === 'status') return parse(obj({ type: oneOf(['status'] as const), status: oneOf(REVIEW_STATUSES), rejectReason: optional(nullable(str(500))) }), v) as BulkAction;
  if (o.type === 'services') return parse(obj({ type: oneOf(['services'] as const), services }), v) as BulkAction;
  if (o.type === 'sector') return parse(obj({ type: oneOf(['sector'] as const), sector: str(120, { min: 1 }), sectorId: nullable(str(80)) }), v) as BulkAction;
  throw new DataError('invalid_request', 'Gönderilen bilgiler geçersiz.', `${p}: unknown action`);
}

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

export function createDiscoveryRoutes(service: DiscoveryServiceApi | null, options: { maxBodyBytes: number }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;
    if (!/^\/api\/discovery(\/|$)/.test(pathname)) return false;
    if (!service) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; aday incelemesi yapılamaz.' } });
      return true;
    }
    const method = req.method ?? 'GET';
    if (method !== 'GET' && !sameOriginJson(req)) {
      sendJson(res, 403, { error: { code: 'invalid_request', message: 'Bu işlem yalnızca KITE arayüzünden yapılabilir.' } });
      return true;
    }
    const body = async <T,>(v: Validator<T>) => parse(v, await readJson(req, options.maxBodyBytes));
    const ok = (payload: unknown) => void sendJson(res, 200, payload);
    const m = (pattern: string) => pathname.match(new RegExp(`^/api/discovery/${pattern}$`));
    let r: RegExpMatchArray | null;
    try {
      if (pathname === '/api/discovery/status' && method === 'GET') return ok({ realRuns: service.realRuns() }), true;
      if ((r = m('jobs/(rsch_[A-Za-z0-9_]{1,80})')) && method === 'GET') return ok(service.job(r[1])), true;
      if ((r = m(`candidates/${RESULT_ID}/review`)) && method === 'PUT') return ok({ candidate: service.updateReview(r[1], (await body(obj({ review: reviewPatch }))).review) }), true;
      if ((r = m(`candidates/${RESULT_ID}/duplicate-ack`)) && method === 'POST') {
        const b = await body(obj({ key: str(120, { min: 1 }), confirmed: bool }));
        return ok({ candidate: service.acknowledgeDuplicate(r[1], b.key, b.confirmed) }), true;
      }
      if ((r = m(`candidates/${RESULT_ID}/versions`)) && method === 'GET') return ok({ versions: service.versions(r[1]) }), true;
      if ((r = m(`candidates/${RESULT_ID}/reresearch`)) && method === 'POST') {
        await body(obj({}));
        return ok(await service.reresearch(r[1])), true;
      }
      if (pathname === '/api/discovery/bulk' && method === 'POST') {
        const raw = (await readJson(req, options.maxBodyBytes)) as Record<string, unknown> | null;
        const ids = parse(arr(str(90, { min: 1 }), 100), raw?.resultIds);
        return ok({ results: service.bulk(ids, bulkAction(raw?.action, 'action')) }), true;
      }
      if (pathname === '/api/discovery/convert' && method === 'POST') {
        const b = await body(obj({ items: arr(obj({ resultId: str(90, { min: 1 }), services }), 100) }));
        return ok({ results: service.convert(b.items) }), true;
      }
      sendJson(res, 404, { error: { code: 'not_found', message: 'İstenen işlem bulunamadı.' } });
    } catch (e) {
      if (res.writableEnded || res.destroyed) return true;
      if (e instanceof ProspectingError) sendJson(res, e.status, { error: { code: e.code, message: e.message } });
      else if (e instanceof DataError) sendJson(res, e.code === 'not_found' ? 404 : 400, { error: { code: e.code, message: e.userMessage } });
      else if (e instanceof RequestValidationError) sendJson(res, 400, { error: { code: 'invalid_request', message: 'Gönderilen bilgiler geçersiz.' } });
      else {
        // Never log request bodies (reviewer notes may contain customer details).
        console.error(`[discovery] ${method} ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendJson(res, 500, { error: { code: 'storage_error', message: 'İşlem tamamlanamadı. Lütfen tekrar dene.' } });
      }
    }
    return true;
  };
}
