// Manual tasks API (Phase 11). Every mutation returns the task and its company (when linked).
//   GET  /api/tasks?company=<id>          open tasks of a company (company drawer card)
//   POST /api/tasks                       { task }               create (status Açık)
//   PUT  /api/tasks/:id                   { task }               edit fields (status unchanged)
//   POST /api/tasks/:id/status            { to }                 Tamamlandı / İptal / reopen
// Mutating calls must be same-origin JSON requests. No delete: tasks are cancelled instead.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TASK_NOTES_MAX, TASK_PRIORITIES, TASK_STATUSES, TASK_TITLE_MAX, type TaskInput } from '../../src/domain/tasks';
import { readJson, sendJson } from '../http';
import { bool, DataError, id, isoDate, nullable, obj, oneOf, parse, str, type Validator } from '../persistence/schema';
import { RequestValidationError } from '../research/validateRequest';
import { TaskError, type TaskServiceApi } from './service';

const taskInput: Validator<TaskInput> = obj({
  title: str(TASK_TITLE_MAX, { min: 1 }),
  notes: str(TASK_NOTES_MAX),
  priority: oneOf(TASK_PRIORITIES),
  dueAt: nullable(isoDate),
  dueHasTime: bool,
  owner: nullable(str(120)),
  companyId: nullable(id),
  customerId: nullable(id),
});

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

export function createTaskRoutes(service: TaskServiceApi | null, options: { maxBodyBytes: number }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;
    if (!/^\/api\/tasks(\/|$)/.test(pathname)) return false;
    if (!service) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; görev işlemleri yapılamaz.' } });
      return true;
    }
    const method = req.method ?? 'GET';
    if (method !== 'GET' && !sameOriginJson(req)) {
      sendJson(res, 403, { error: { code: 'invalid_request', message: 'Bu işlem yalnızca KITE arayüzünden yapılabilir.' } });
      return true;
    }
    const body = async <T,>(v: Validator<T>) => parse(v, await readJson(req, options.maxBodyBytes));
    let m: RegExpMatchArray | null;
    try {
      if (pathname === '/api/tasks' && method === 'GET') {
        const company = url.searchParams.get('company');
        if (!company || !/^cmp_[A-Za-z0-9_]{1,80}$/.test(company)) {
          sendJson(res, 400, { error: { code: 'invalid_request', message: 'Şirket belirtilmedi.' } });
          return true;
        }
        sendJson(res, 200, { tasks: service.listOpenForCompany(company) });
        return true;
      }
      if (pathname === '/api/tasks' && method === 'POST') {
        sendJson(res, 201, service.create((await body(obj({ task: taskInput }))).task));
        return true;
      }
      if ((m = pathname.match(/^\/api\/tasks\/(tsk_[A-Za-z0-9_]{1,80})$/)) && method === 'PUT') {
        sendJson(res, 200, service.update(m[1], (await body(obj({ task: taskInput }))).task));
        return true;
      }
      if ((m = pathname.match(/^\/api\/tasks\/(tsk_[A-Za-z0-9_]{1,80})\/status$/)) && method === 'POST') {
        sendJson(res, 200, service.changeStatus(m[1], (await body(obj({ to: oneOf(TASK_STATUSES) }))).to));
        return true;
      }
      sendJson(res, 404, { error: { code: 'not_found', message: 'İstenen işlem bulunamadı.' } });
    } catch (e) {
      if (res.writableEnded || res.destroyed) return true;
      if (e instanceof TaskError) sendJson(res, e.status, { error: { code: e.code, message: e.message } });
      else if (e instanceof DataError) sendJson(res, e.code === 'not_found' ? 404 : 400, { error: { code: e.code, message: e.userMessage } });
      else if (e instanceof RequestValidationError) sendJson(res, 400, { error: { code: 'invalid_request', message: 'Gönderilen bilgiler geçersiz.' } });
      else {
        // Never log request bodies (task notes may contain customer details).
        console.error(`[tasks] ${method} ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendJson(res, 500, { error: { code: 'storage_error', message: 'İşlem tamamlanamadı. Lütfen tekrar dene.' } });
      }
    }
    return true;
  };
}
