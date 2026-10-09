// Sales intelligence API (Phase 14). Read-only:
//   GET /api/sales-intelligence              ranked insights (customers and closed companies left out) + diagnostics
//   GET /api/sales-intelligence/:companyId   one company's insight (excluded ones are marked)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http';
import { SalesIntelligenceError, type SalesIntelligenceService } from './service';

export function createSalesIntelligenceRoutes(service: SalesIntelligenceService | null) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;
    if (!/^\/api\/sales-intelligence(\/|$)/.test(pathname)) return false;
    if (!service) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor.' } });
      return true;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: { code: 'invalid_request', message: 'Bu adres yalnızca okunur.' } });
      return true;
    }
    try {
      if (pathname === '/api/sales-intelligence') return sendJson(res, 200, service.list()), true;
      const m = pathname.match(/^\/api\/sales-intelligence\/([A-Za-z0-9_]{3,80})$/);
      if (m) return sendJson(res, 200, { insight: service.company(m[1]) }), true;
      sendJson(res, 404, { error: { code: 'not_found', message: 'İstenen işlem bulunamadı.' } });
    } catch (e) {
      if (e instanceof SalesIntelligenceError) sendJson(res, 404, { error: { code: e.code, message: e.message } });
      else {
        console.error(`[sales-intelligence] ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendJson(res, 500, { error: { code: 'storage_error', message: 'Satış özeti hazırlanamadı.' } });
      }
    }
    return true;
  };
}
