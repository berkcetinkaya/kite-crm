// Finance API (schema v9). KITE Finans and Berk have separate paths, services and tables.
//   GET  /api/finance/kite                                   { entries }
//   POST /api/finance/kite/entries                           { entry }            create
//   PUT  /api/finance/kite/entries/:id                       { entry }            edit
//   POST /api/finance/kite/entries/:id/status                { to, paidOn }       Ödendi / İptal / Bekliyor
//   POST /api/finance/kite/entries/:id/next                  {}                   next recurring occurrence
//   POST /api/finance/kite/entries/:id/delete                {}
//   GET  /api/finance/personal                               { entries, debts, budgets }
//   POST|PUT /api/finance/personal/entries[/:id], …/status, …/next, …/delete     (same as KITE)
//   POST /api/finance/personal/debts                         { debt }
//   PUT  /api/finance/personal/debts/:id                     { debt }
//   POST /api/finance/personal/debts/:id/delete              {}
//   POST /api/finance/personal/debts/:id/payments            { payment }
//   POST /api/finance/personal/debts/:id/payments/:pid/delete {}
//   PUT  /api/finance/personal/budgets/:currency             { monthlyLimitMinor | null }
// Every mutation answers with the complete, fresh data of its side. Mutating calls must be same-origin
// JSON requests (deletes are POSTs for that reason).
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ENTRY_KINDS,
  FINANCE_COUNTERPARTY_MAX,
  FINANCE_CURRENCIES,
  FINANCE_MAX_AMOUNT_MINOR,
  FINANCE_NOTES_MAX,
  FINANCE_STATUSES,
  FINANCE_TITLE_MAX,
  RECURRENCES,
  type DebtPaymentInput,
  type FinanceEntryInput,
  type KiteFinanceEntryInput,
  type PersonalDebtInput,
} from '../../src/domain/finance';
import { readJson, sendJson } from '../http';
import { DataError, id, nullable, num, obj, oneOf, optional, parse, str, type Validator } from '../persistence/schema';
import { RequestValidationError } from '../research/validateRequest';
import { FinanceError, type KiteFinanceServiceApi, type PersonalFinanceServiceApi } from './service';

const amount = num(1, FINANCE_MAX_AMOUNT_MINOR, { int: true });
const dayStr = str(10, { min: 10 });

const entryShape = {
  kind: oneOf(ENTRY_KINDS),
  title: str(FINANCE_TITLE_MAX, { min: 1 }),
  notes: str(FINANCE_NOTES_MAX),
  counterparty: str(FINANCE_COUNTERPARTY_MAX),
  amountMinor: amount,
  currency: oneOf(FINANCE_CURRENCIES),
  category: str(40, { min: 1 }),
  date: dayStr,
  dueDate: nullable(dayStr),
  paidOn: nullable(dayStr),
  recurrence: oneOf(RECURRENCES),
};
const personalEntryInput: Validator<FinanceEntryInput> = obj(entryShape);
const kiteEntryInput: Validator<KiteFinanceEntryInput> = obj({ ...entryShape, companyId: nullable(id), customerId: nullable(id) });
const statusInput = obj({ to: oneOf(FINANCE_STATUSES), paidOn: nullable(dayStr) });
const debtInput: Validator<PersonalDebtInput> = obj({
  creditor: str(120, { min: 1 }),
  notes: str(FINANCE_NOTES_MAX),
  currency: oneOf(FINANCE_CURRENCIES),
  principalMinor: amount,
  startDate: dayStr,
  nextDueDate: nullable(dayStr),
  installmentMinor: nullable(amount),
});
const paymentInput: Validator<DebtPaymentInput> = (v, p) => {
  const base = obj({ amountMinor: amount, paidOn: dayStr, notes: str(FINANCE_NOTES_MAX), nextDueDate: optional(nullable(dayStr)) })(v, p);
  // "nextDueDate": null clears the date; a missing key keeps it.
  const raw = v as Record<string, unknown>;
  return { ...base, nextDueDate: 'nextDueDate' in raw ? (base.nextDueDate ?? null) : undefined };
};

const ENTRY_ID = '((?:kfe|pfe)_[A-Za-z0-9_]{1,80})';
const DEBT_ID = '(dbt_[A-Za-z0-9_]{1,80})';
const PAYMENT_ID = '(dpy_[A-Za-z0-9_]{1,80})';

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

export function createFinanceRoutes(services: { kite: KiteFinanceServiceApi; personal: PersonalFinanceServiceApi } | null, options: { maxBodyBytes: number }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;
    if (!/^\/api\/finance(\/|$)/.test(pathname)) return false;
    if (!services) {
      sendJson(res, 503, { error: { code: 'storage_unavailable', message: 'Veri deposu kullanılamıyor; finans kayıtları açılamaz.' } });
      return true;
    }
    const { kite, personal } = services;
    const method = req.method ?? 'GET';
    if (method !== 'GET' && !sameOriginJson(req)) {
      sendJson(res, 403, { error: { code: 'invalid_request', message: 'Bu işlem yalnızca KITE arayüzünden yapılabilir.' } });
      return true;
    }
    const body = async <T,>(v: Validator<T>) => parse(v, await readJson(req, options.maxBodyBytes));
    const match = (re: string, m: string) => (method === m ? pathname.match(new RegExp(`^${re}$`)) : null);
    const ok = (status: number, payload: unknown) => {
      sendJson(res, status, payload);
      return true;
    };
    let m: RegExpMatchArray | null;
    try {
      // ----- KITE Finans -----
      if (match('/api/finance/kite', 'GET')) return ok(200, kite.list());
      if (match('/api/finance/kite/entries', 'POST')) {
        const entry = kite.create((await body(obj({ entry: kiteEntryInput }))).entry);
        return ok(201, { entry, ...kite.list() });
      }
      if ((m = match(`/api/finance/kite/entries/${ENTRY_ID}`, 'PUT'))) {
        const entry = kite.update(m[1], (await body(obj({ entry: kiteEntryInput }))).entry);
        return ok(200, { entry, ...kite.list() });
      }
      if ((m = match(`/api/finance/kite/entries/${ENTRY_ID}/status`, 'POST'))) {
        const { to, paidOn } = await body(statusInput);
        return ok(200, { entry: kite.changeStatus(m[1], to, paidOn), ...kite.list() });
      }
      if ((m = match(`/api/finance/kite/entries/${ENTRY_ID}/next`, 'POST'))) return ok(201, { entry: kite.createNext(m[1]), ...kite.list() });
      if ((m = match(`/api/finance/kite/entries/${ENTRY_ID}/delete`, 'POST'))) {
        kite.delete(m[1]);
        return ok(200, kite.list());
      }

      // ----- Berk -----
      if (match('/api/finance/personal', 'GET')) return ok(200, personal.list());
      if (match('/api/finance/personal/entries', 'POST')) {
        const entry = personal.createEntry((await body(obj({ entry: personalEntryInput }))).entry);
        return ok(201, { entry, ...personal.list() });
      }
      if ((m = match(`/api/finance/personal/entries/${ENTRY_ID}`, 'PUT'))) {
        const entry = personal.updateEntry(m[1], (await body(obj({ entry: personalEntryInput }))).entry);
        return ok(200, { entry, ...personal.list() });
      }
      if ((m = match(`/api/finance/personal/entries/${ENTRY_ID}/status`, 'POST'))) {
        const { to, paidOn } = await body(statusInput);
        return ok(200, { entry: personal.changeEntryStatus(m[1], to, paidOn), ...personal.list() });
      }
      if ((m = match(`/api/finance/personal/entries/${ENTRY_ID}/next`, 'POST'))) return ok(201, { entry: personal.createNextEntry(m[1]), ...personal.list() });
      if ((m = match(`/api/finance/personal/entries/${ENTRY_ID}/delete`, 'POST'))) {
        personal.deleteEntry(m[1]);
        return ok(200, personal.list());
      }
      if (match('/api/finance/personal/debts', 'POST')) {
        const debt = personal.createDebt((await body(obj({ debt: debtInput }))).debt);
        return ok(201, { debt, ...personal.list() });
      }
      if ((m = match(`/api/finance/personal/debts/${DEBT_ID}`, 'PUT'))) {
        const debt = personal.updateDebt(m[1], (await body(obj({ debt: debtInput }))).debt);
        return ok(200, { debt, ...personal.list() });
      }
      if ((m = match(`/api/finance/personal/debts/${DEBT_ID}/delete`, 'POST'))) {
        personal.deleteDebt(m[1]);
        return ok(200, personal.list());
      }
      if ((m = match(`/api/finance/personal/debts/${DEBT_ID}/payments`, 'POST'))) {
        const debt = personal.addPayment(m[1], (await body(obj({ payment: paymentInput }))).payment);
        return ok(201, { debt, ...personal.list() });
      }
      if ((m = match(`/api/finance/personal/debts/${DEBT_ID}/payments/${PAYMENT_ID}/delete`, 'POST'))) {
        const debt = personal.deletePayment(m[1], m[2]);
        return ok(200, { debt, ...personal.list() });
      }
      if ((m = match('/api/finance/personal/budgets/([A-Z]{3})', 'PUT'))) {
        const currency = oneOf(FINANCE_CURRENCIES)(m[1], 'currency');
        const { monthlyLimitMinor } = await body(obj({ monthlyLimitMinor: nullable(amount) }));
        personal.setBudget(currency, monthlyLimitMinor);
        return ok(200, personal.list());
      }
      sendJson(res, 404, { error: { code: 'not_found', message: 'İstenen işlem bulunamadı.' } });
    } catch (e) {
      if (res.writableEnded || res.destroyed) return true;
      if (e instanceof FinanceError) sendJson(res, e.status, { error: { code: e.code, message: e.message } });
      else if (e instanceof DataError) sendJson(res, e.code === 'not_found' ? 404 : 400, { error: { code: e.code, message: e.userMessage } });
      else if (e instanceof RequestValidationError) sendJson(res, 400, { error: { code: 'invalid_request', message: 'Gönderilen bilgiler geçersiz.' } });
      else {
        // Never log request bodies (amounts and notes are private).
        console.error(`[finance] ${method} ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendJson(res, 500, { error: { code: 'storage_error', message: 'İşlem tamamlanamadı. Lütfen tekrar dene.' } });
      }
    }
    return true;
  };
}
