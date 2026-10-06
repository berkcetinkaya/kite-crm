// Test controls for browser QA (Phase 7). Mounted ONLY when the server runs fully offline:
// KITE_TEST_CONTROLS=1 with the fixture Gmail AND the fixture research/mail provider (see
// config.testControls). With real Gmail or Anthropic these routes do not exist at all.
//   GET  /api/test/state                     current (test) time and clock offset
//   POST /api/test/clock                     { advanceDays?, advanceMs?, reset? }: move the clock
//   POST /api/test/gmail/reply               { companyId, shape }: a later message in the company's thread
//   POST /api/test/gmail/fail-reads          { fail }: Gmail thread reads fail (pre-send check)
//   POST /api/test/gmail/revoke              Berk revoked KITE's access in his Google account
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http';
import type { Clock } from '../clock';
import type { Store } from '../db/store';
import type { FixtureControls } from '../gmail/fixture';

export function createTestRoutes(deps: { clock: Clock; store: Store | null; fixture: FixtureControls }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/api/test/')) return false;
    const method = req.method ?? 'GET';
    const state = () => ({ now: deps.clock.now().toISOString(), offsetMs: deps.clock.offsetMs(), fixture: true });
    if (url.pathname === '/api/test/state' && method === 'GET') return void sendJson(res, 200, state()), true;
    if (method !== 'POST' || !(req.headers['content-type'] ?? '').startsWith('application/json')) {
      sendJson(res, 400, { error: { code: 'invalid_request', message: 'JSON POST required' } });
      return true;
    }
    const body = ((await readJson(req, 10_000)) ?? {}) as Record<string, unknown>;
    if (url.pathname === '/api/test/clock') {
      if (body.reset === true) deps.clock.setOffsetMs(0);
      const days = Number(body.advanceDays ?? 0);
      const ms = Number(body.advanceMs ?? 0);
      if (Number.isFinite(days) && Number.isFinite(ms)) deps.clock.setOffsetMs(deps.clock.offsetMs() + days * 86_400_000 + ms);
      return void sendJson(res, 200, state()), true;
    }
    if (url.pathname === '/api/test/gmail/reply') {
      const companyId = String(body.companyId ?? '');
      const shape = body.shape === 'mixed' || body.shape === 'self' ? body.shape : 'reply';
      const send = deps.store?.outreach.listThreadSends().find((s) => s.companyId === companyId);
      const added = send?.gmailThreadId ? deps.fixture.addReply(send.gmailThreadId, { shape, at: deps.clock.now().getTime() }) : null;
      return void sendJson(res, added ? 200 : 404, added ? { added: { id: added.id, threadId: added.threadId, labels: added.labelIds } } : { error: { code: 'not_found', message: 'thread not found in fixture mailbox' } }), true;
    }
    if (url.pathname === '/api/test/gmail/fail-reads') {
      deps.fixture.failReads(body.fail === true);
      return void sendJson(res, 200, { failReads: body.fail === true }), true;
    }
    if (url.pathname === '/api/test/gmail/revoke') {
      deps.fixture.revokeExternally();
      return void sendJson(res, 200, { revoked: true }), true;
    }
    sendJson(res, 404, { error: { code: 'not_found', message: 'unknown test control' } });
    return true;
  };
}
