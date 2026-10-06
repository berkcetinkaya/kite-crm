// Sales API (Phase 8). Mutations return the changed record and the updated company.
//   GET  /api/sales                                 meetings and proposals
//   POST /api/sales/meetings                        { companyId, meeting, moveCompanyTo? }
//   PUT  /api/sales/meetings/:id                    { meeting }
//   POST /api/sales/meetings/:id/complete           { outcome, notes, nextActionLabel, nextActionDueAt, setCompanyNextAction, moveCompanyTo? }
//   POST /api/sales/meetings/:id/cancel             {}
//   POST /api/sales/proposals                       { companyId, proposal, addOpportunities? }
//   PUT  /api/sales/proposals/:id                   { proposal, addOpportunities? }
//   POST /api/sales/proposals/:id/status            { to, sentAt?, decidedAt?, lossReason?, moveCompanyTo? }
// Mutating calls must be same-origin JSON requests.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BILLING_TYPES,
  CURRENCIES,
  MAX_AMOUNT_MINOR,
  MAX_CONTRACT_MONTHS,
  MAX_PROPOSAL_ITEMS,
  MEETING_TYPES,
  PROPOSAL_STATUSES,
  TAX_MODES,
  type MeetingInput,
  type ProposalInput,
} from '../../src/domain/sales';
import { SALES_STATUS_ORDER } from '../../src/domain/salesStatus';
import { SERVICE_KEYS } from '../../src/domain/services';
import { readJson, sendJson } from '../http';
import { arr, bool, DataError, id, isoDate, nullable, num, obj, oneOf, optional, parse, str, type Validator } from '../persistence/schema';
import { RequestValidationError } from '../research/validateRequest';
import { SalesError, type SalesService } from './service';

const ID = '([a-z]{2,8}_[A-Za-z0-9_]{1,80})';
const optText = (max: number): Validator<string | null> => (v, p) => {
  const s = nullable(str(max))(v, p);
  return s ? s : null;
};
const stageMove = optional(nullable(oneOf(SALES_STATUS_ORDER)));

const meetingInput: Validator<MeetingInput> = obj({
  scheduledAt: isoDate,
  type: oneOf(MEETING_TYPES),
  contactId: nullable(id),
  notes: str(4000),
  outcome: str(4000),
  nextActionLabel: optText(200),
  nextActionDueAt: nullable(isoDate),
});

const proposalInput: Validator<ProposalInput> = obj({
  title: str(200, { min: 1 }),
  currency: oneOf(CURRENCIES),
  contractMonths: nullable(num(1, MAX_CONTRACT_MONTHS, { int: true })),
  validUntil: nullable(isoDate),
  notes: str(4000),
  taxMode: oneOf(TAX_MODES),
  taxRateBp: nullable(num(0, 10_000, { int: true })),
  items: arr(
    obj({
      service: oneOf(SERVICE_KEYS),
      description: str(300),
      billingType: oneOf(BILLING_TYPES),
      unitAmountMinor: num(0, MAX_AMOUNT_MINOR, { int: true }),
      quantity: num(1, 1000, { int: true }),
    }),
    MAX_PROPOSAL_ITEMS,
  ),
});
const addOpportunities = optional(arr(oneOf(SERVICE_KEYS), SERVICE_KEYS.length));

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

export function createSalesRoutes(service: SalesService | null, options: { maxBodyBytes: number }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;
    if (!/^\/api\/sales(\/|$)/.test(pathname)) return false;
    if (!service) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; satış işlemleri yapılamaz.' } });
      return true;
    }
    const s = service;
    const method = req.method ?? 'GET';
    if (method !== 'GET' && !sameOriginJson(req)) {
      sendJson(res, 403, { error: { code: 'invalid_request', message: 'Bu işlem yalnızca KITE arayüzünden yapılabilir.' } });
      return true;
    }
    const body = async <T,>(v: Validator<T>) => parse(v, await readJson(req, options.maxBodyBytes));
    const ok = (payload: unknown, status = 200) => void sendJson(res, status, payload);
    let m: RegExpMatchArray | null;

    try {
      if (pathname === '/api/sales' && method === 'GET') return ok(s.list()), true;

      if (pathname === '/api/sales/meetings' && method === 'POST') {
        const b = await body(obj({ companyId: id, meeting: meetingInput, moveCompanyTo: stageMove }));
        return ok(s.createMeeting(b.companyId, b.meeting, { moveCompanyTo: b.moveCompanyTo }), 201), true;
      }
      if ((m = pathname.match(new RegExp(`^/api/sales/meetings/${ID}$`))) && method === 'PUT') {
        return ok(s.updateMeeting(m[1], (await body(obj({ meeting: meetingInput }))).meeting)), true;
      }
      if ((m = pathname.match(new RegExp(`^/api/sales/meetings/${ID}/complete$`))) && method === 'POST') {
        const b = await body(
          obj({ outcome: str(4000), notes: str(4000), nextActionLabel: optText(200), nextActionDueAt: nullable(isoDate), setCompanyNextAction: bool, moveCompanyTo: stageMove }),
        );
        return ok(s.completeMeeting(m[1], b)), true;
      }
      if ((m = pathname.match(new RegExp(`^/api/sales/meetings/${ID}/cancel$`))) && method === 'POST') {
        await body(obj({}));
        return ok(s.cancelMeeting(m[1])), true;
      }

      if (pathname === '/api/sales/proposals' && method === 'POST') {
        const b = await body(obj({ companyId: id, proposal: proposalInput, addOpportunities }));
        return ok(s.createProposal(b.companyId, b.proposal, { addOpportunities: b.addOpportunities }), 201), true;
      }
      if ((m = pathname.match(new RegExp(`^/api/sales/proposals/${ID}$`))) && method === 'PUT') {
        const b = await body(obj({ proposal: proposalInput, addOpportunities }));
        return ok(s.updateProposal(m[1], b.proposal, { addOpportunities: b.addOpportunities })), true;
      }
      if ((m = pathname.match(new RegExp(`^/api/sales/proposals/${ID}/status$`))) && method === 'POST') {
        const b = await body(obj({ to: oneOf(PROPOSAL_STATUSES), sentAt: optional(nullable(isoDate)), decidedAt: optional(nullable(isoDate)), lossReason: optional(optText(1000)), moveCompanyTo: stageMove }));
        return ok(s.transitionProposal(m[1], b)), true;
      }

      sendJson(res, 404, { error: { code: 'not_found', message: 'İstenen işlem bulunamadı.' } });
    } catch (e) {
      if (res.writableEnded || res.destroyed) return true;
      if (e instanceof SalesError) sendJson(res, e.status, { error: { code: e.code, message: e.message } });
      else if (e instanceof DataError) sendJson(res, e.code === 'not_found' ? 404 : 400, { error: { code: e.code, message: e.userMessage } });
      else if (e instanceof RequestValidationError) sendJson(res, 400, { error: { code: 'invalid_request', message: 'Gönderilen bilgiler geçersiz.' } });
      else {
        console.error(`[sales] ${method} ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendJson(res, 500, { error: { code: 'storage_error', message: 'İşlem tamamlanamadı. Lütfen tekrar dene.' } });
      }
    }
    return true;
  };
}
