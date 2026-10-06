// Dashboard API (Phase 10), read-only:
//   GET /api/dashboard?range=7d|30d|90d|month     Ana Sayfa snapshot (default 30d)
// Any other method is refused; nothing here changes data.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_DASHBOARD_RANGE, isDashboardRange } from '../../src/domain/dashboard';
import { sendJson } from '../http';
import type { ReportingService } from './service';

export function createReportingRoutes(service: ReportingService | null) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== '/api/dashboard') return false;
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Bu adres yalnızca okuma içindir.' } });
      return true;
    }
    if (!service) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; özet gösterilemiyor.' } });
      return true;
    }
    const range = url.searchParams.get('range') ?? DEFAULT_DASHBOARD_RANGE;
    if (!isDashboardRange(range)) {
      sendJson(res, 400, { error: { code: 'invalid_request', message: 'Geçersiz tarih aralığı.' } });
      return true;
    }
    try {
      sendJson(res, 200, service.dashboard(range));
    } catch (e) {
      console.error('[dashboard] failed:', e instanceof Error ? e.message : e);
      sendJson(res, 500, { error: { code: 'storage_error', message: 'Özet hazırlanamadı. Lütfen tekrar dene.' } });
    }
    return true;
  };
}
