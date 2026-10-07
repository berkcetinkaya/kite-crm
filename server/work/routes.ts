// Work API (Phase 11), read-only:
//   GET /api/work?completed=30|90      every open work item + manual tasks done in the last N days
// Any other method is refused; nothing here changes data.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { COMPLETED_OLDER_DAYS, COMPLETED_RECENT_DAYS } from '../../src/domain/tasks';
import { sendJson } from '../http';
import type { WorkServiceApi } from './service';

export function createWorkRoutes(service: WorkServiceApi | null) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== '/api/work') return false;
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Bu adres yalnızca okuma içindir.' } });
      return true;
    }
    if (!service) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; işler gösterilemiyor.' } });
      return true;
    }
    const raw = url.searchParams.get('completed') ?? String(COMPLETED_RECENT_DAYS);
    const days = Number(raw);
    if (days !== COMPLETED_RECENT_DAYS && days !== COMPLETED_OLDER_DAYS) {
      sendJson(res, 400, { error: { code: 'invalid_request', message: 'Geçersiz dönem.' } });
      return true;
    }
    try {
      sendJson(res, 200, service.work(days));
    } catch (e) {
      console.error('[work] failed:', e instanceof Error ? e.message : e);
      sendJson(res, 500, { error: { code: 'storage_error', message: 'İşler hazırlanamadı. Lütfen tekrar dene.' } });
    }
    return true;
  };
}
