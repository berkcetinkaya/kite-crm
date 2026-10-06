// Customers API (Phase 9). Every mutation returns the full customer and the updated company.
//   GET  /api/customers                                   all customers (aggregates)
//   POST /api/customers                                   start onboarding { companyId, onboarding }
//   PUT  /api/customers/:id                               details { customer, owner? }
//   POST /api/customers/:id/status                        { to, confirmOpenItems?, date?, moveCompanyTo? }
//   POST /api/customers/:id/services                      { service }
//   PUT  /api/customers/services/:id                      { service }
//   POST /api/customers/services/:id/status               { to, date? }
//   POST /api/customers/:id/onboarding                    { items }
//   PUT  /api/customers/onboarding/:id                    { label, notes, dueDate }
//   POST /api/customers/onboarding/:id/status             { to }
//   POST /api/customers/onboarding/:id/delete             {}
//   POST /api/customers/:id/access                        { items }
//   PUT  /api/customers/access/:id                        { label, notes }
//   POST /api/customers/access/:id/status                 { to }
//   POST /api/customers/access/:id/delete                 {}
// Mutating calls must be same-origin JSON requests. No field accepts credentials.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ACCESS_KINDS,
  ACCESS_STATUSES,
  CUSTOMER_SERVICE_STATUSES,
  CUSTOMER_STATUSES,
  ONBOARDING_STATUSES,
  type AccessInput,
  type CustomerDetailsInput,
  type CustomerServiceInput,
  type OnboardingItemInput,
} from '../../src/domain/customers';
import { BILLING_TYPES, CURRENCIES, MAX_AMOUNT_MINOR } from '../../src/domain/sales';
import { SALES_STATUS_ORDER } from '../../src/domain/salesStatus';
import { SERVICE_KEYS } from '../../src/domain/services';
import { readJson, sendJson } from '../http';
import { arr, bool, DataError, id, isoDate, nullable, num, obj, oneOf, optional, parse, str, type Validator } from '../persistence/schema';
import { RequestValidationError } from '../research/validateRequest';
import { CustomerError, type CustomerServiceApi } from './service';

const ref = (prefix: string) => `(${prefix}_[A-Za-z0-9_]{1,80})`;
const looseRef: Validator<string | null> = (v, p) => {
  const s = nullable(str(100))(v, p);
  if (s && !/^[A-Za-z0-9_]+$/.test(s)) throw new DataError('invalid_request', 'Gönderilen bilgiler geçersiz.', `${p}: invalid reference`);
  return s || null;
};

const serviceInput: Validator<CustomerServiceInput> = obj({
  service: oneOf(SERVICE_KEYS),
  label: str(120),
  billingType: nullable(oneOf(BILLING_TYPES)),
  amountMinor: nullable(num(0, MAX_AMOUNT_MINOR, { int: true })),
  currency: nullable(oneOf(CURRENCIES)),
  sourceProposalId: looseRef,
  sourceItemId: looseRef,
  notes: str(2000),
  startDate: nullable(isoDate),
  endDate: nullable(isoDate),
});
const onboardingInput: Validator<OnboardingItemInput> = obj({ label: str(200, { min: 1 }), templateKey: nullable(str(60)), dueDate: nullable(isoDate), notes: str(2000) });
const accessInput: Validator<AccessInput> = obj({ kind: oneOf(ACCESS_KINDS), label: str(120), notes: str(2000) });
const details = { startDate: isoDate, primaryContactId: nullable(id), commercialNotes: str(4000), operationalNotes: str(4000) };
const detailsInput: Validator<CustomerDetailsInput> = obj({ ...details, endDate: nullable(isoDate) });
const startInput = obj({
  ...details,
  sourceProposalId: nullable(id),
  services: arr(serviceInput, 30),
  onboardingItems: arr(onboardingInput, 60),
  accessItems: arr(accessInput, 30),
  moveCompanyToClient: bool,
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

export function createCustomerRoutes(service: CustomerServiceApi | null, options: { maxBodyBytes: number }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;
    if (!/^\/api\/customers(\/|$)/.test(pathname)) return false;
    if (!service) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; müşteri işlemleri yapılamaz.' } });
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
    const m = (pattern: string) => pathname.match(new RegExp(`^/api/customers/${pattern}$`));
    let r: RegExpMatchArray | null;

    try {
      if (pathname === '/api/customers' && method === 'GET') return ok(s.list()), true;
      if (pathname === '/api/customers' && method === 'POST') {
        const b = await body(obj({ companyId: id, onboarding: startInput }));
        return ok(s.startOnboarding(b.companyId, b.onboarding), 201), true;
      }

      if ((r = m(`services/${ref('csv')}`)) && method === 'PUT') return ok(s.updateService(r[1], (await body(obj({ service: serviceInput }))).service)), true;
      if ((r = m(`services/${ref('csv')}/status`)) && method === 'POST') {
        const b = await body(obj({ to: oneOf(CUSTOMER_SERVICE_STATUSES), date: optional(nullable(isoDate)) }));
        return ok(s.changeServiceStatus(r[1], b.to, b.date)), true;
      }
      if ((r = m(`onboarding/${ref('onb')}`)) && method === 'PUT') return ok(s.updateOnboardingItem(r[1], await body(obj({ label: str(200, { min: 1 }), notes: str(2000), dueDate: nullable(isoDate) })))), true;
      if ((r = m(`onboarding/${ref('onb')}/status`)) && method === 'POST') return ok(s.setOnboardingStatus(r[1], (await body(obj({ to: oneOf(ONBOARDING_STATUSES) }))).to)), true;
      if ((r = m(`onboarding/${ref('onb')}/delete`)) && method === 'POST') {
        await body(obj({}));
        return ok(s.deleteOnboardingItem(r[1])), true;
      }
      if ((r = m(`access/${ref('acc')}`)) && method === 'PUT') return ok(s.updateAccess(r[1], await body(obj({ label: str(120), notes: str(2000) })))), true;
      if ((r = m(`access/${ref('acc')}/status`)) && method === 'POST') return ok(s.setAccessStatus(r[1], (await body(obj({ to: oneOf(ACCESS_STATUSES) }))).to)), true;
      if ((r = m(`access/${ref('acc')}/delete`)) && method === 'POST') {
        await body(obj({}));
        return ok(s.deleteAccess(r[1])), true;
      }

      if ((r = m(ref('cus'))) && method === 'PUT') {
        const b = await body(obj({ customer: detailsInput, owner: optional(nullable(str(120))) }));
        return ok(s.updateCustomer(r[1], b.customer, b.owner)), true;
      }
      if ((r = m(`${ref('cus')}/status`)) && method === 'POST') {
        const b = await body(obj({ to: oneOf(CUSTOMER_STATUSES), confirmOpenItems: optional(bool), date: optional(nullable(isoDate)), moveCompanyTo: optional(nullable(oneOf(SALES_STATUS_ORDER))) }));
        return ok(s.changeStatus(r[1], b)), true;
      }
      if ((r = m(`${ref('cus')}/services`)) && method === 'POST') return ok(s.addService(r[1], (await body(obj({ service: serviceInput }))).service), 201), true;
      if ((r = m(`${ref('cus')}/onboarding`)) && method === 'POST') return ok(s.addOnboardingItems(r[1], (await body(obj({ items: arr(onboardingInput, 60) }))).items), 201), true;
      if ((r = m(`${ref('cus')}/access`)) && method === 'POST') return ok(s.addAccess(r[1], (await body(obj({ items: arr(accessInput, 30) }))).items), 201), true;

      sendJson(res, 404, { error: { code: 'not_found', message: 'İstenen işlem bulunamadı.' } });
    } catch (e) {
      if (res.writableEnded || res.destroyed) return true;
      if (e instanceof CustomerError) sendJson(res, e.status, { error: { code: e.code, message: e.message }, ...e.extra });
      else if (e instanceof DataError) sendJson(res, e.code === 'not_found' ? 404 : 400, { error: { code: e.code, message: e.userMessage } });
      else if (e instanceof RequestValidationError) sendJson(res, 400, { error: { code: 'invalid_request', message: 'Gönderilen bilgiler geçersiz.' } });
      else {
        // Never log request bodies (notes may contain customer details).
        console.error(`[customers] ${method} ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendJson(res, 500, { error: { code: 'storage_error', message: 'İşlem tamamlanamadı. Lütfen tekrar dene.' } });
      }
    }
    return true;
  };
}
