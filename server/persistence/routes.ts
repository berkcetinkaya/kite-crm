// Persistence API (Phase 5.5). Grouped by area; the browser never sees SQL or table concepts.
//   GET    /api/prospects                              list companies
//   POST   /api/prospects                              create a company
//   PATCH  /api/prospects/:id                          edit details
//   POST   /api/prospects/:id/status                   change sales status
//   PUT    /api/prospects/:id/opportunities            replace service opportunities
//   POST   /api/prospects/:id/notes                    add a note
//   POST   /api/prospects/:id/contacts                 add a contact
//   POST   /api/prospects/:id/external-contacts        record a sales contact outside KITE (history only, Phase 14)
//   PUT    /api/prospects/:id/contacts/:contactId      edit a contact
//   GET    /api/research/jobs                          list jobs with their results
//   PUT    /api/research/jobs/:id                      save a job
//   PUT    /api/research/jobs/:id/results              save results of a job
//   POST   /api/research/jobs/:id/transfer             transfer selected results to prospects
//   GET    /api/mail/drafts                            list drafts
//   POST   /api/mail/drafts/generate                   compatibility: delegates to the Phase 13 generation authority
//   POST   /api/mail/drafts/:id/save                   save edits
//   POST   /api/mail/drafts/:id/approve                approve (never sends)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAIL_ERROR_MESSAGES, type MailErrorCode } from '../../src/domain/mail/api';
import { DATA_ERROR_MESSAGES, type DataErrorCode } from '../../src/domain/dataApi';
import { abortOnClose, readJson, sendJson } from '../http';
import { MailSafetyError } from '../mail/generate';
import { OUTREACH_PREP_HTTP, OutreachPrepError } from '../outreachPrep/service';
import { ProviderError } from '../research/provider';
import { RequestValidationError } from '../research/validateRequest';
import { arr, DataError, id, isoDate, nullable, obj, oneOf, optional, parse, str, type Validator } from './schema';
import { EXTERNAL_CONTACT_CHANNELS, MAX_EXTERNAL_NOTE } from '../../src/domain/externalContact';
import type { PersistenceServices } from './services';
import * as V from './validators';

const STATUS: Record<DataErrorCode, number> = { invalid_request: 400, not_found: 404, conflict: 409, storage_error: 500, storage_unavailable: 503 };

function sendDataError(res: ServerResponse, code: DataErrorCode, message = DATA_ERROR_MESSAGES[code]) {
  sendJson(res, STATUS[code], { error: { code, message } });
}

const MAIL_HTTP: Partial<Record<MailErrorCode, number>> = { rate_limit: 429, busy: 429, auth: 502, unavailable: 503, timeout: 504, invalid_response: 502, provider_rejected: 502, refused: 502, unsafe_output: 422 };

type Handler = (ctx: { req: IncomingMessage; res: ServerResponse; params: string[]; body: () => Promise<unknown> }) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  status?: number;
  handler: Handler;
}

const ID = '([A-Za-z0-9_]{3,80})';

export function createDataRoutes(services: PersistenceServices | null, options: { maxBodyBytes: number }) {
  const body =
    <T,>(req: IncomingMessage, validator: Validator<T>) =>
    async () =>
      parse(validator, await readJson(req, options.maxBodyBytes));

  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler, status = 200) =>
    routes.push({ method, pattern: new RegExp(`^${path.replaceAll(':id', ID)}$`), handler, status });

  if (services) {
    const s = services;
    // ---- Prospects ----
    add('GET', '/api/prospects', () => ({ companies: s.companies.list() }));
    add('POST', '/api/prospects', async ({ req }) => ({ company: s.companies.create(await body(req, V.newCompanyInput)()) }), 201);
    add('PATCH', '/api/prospects/:id', async ({ req, params }) => ({ company: s.companies.updateDetails(params[0], await body(req, obj({ patch: V.detailsPatch }))().then((b) => b.patch)) }));
    add('POST', '/api/prospects/:id/status', async ({ req, params }) => ({ company: s.companies.changeStatus(params[0], (await body(req, obj({ status: V.status }))()).status) }));
    add('PUT', '/api/prospects/:id/opportunities', async ({ req, params }) => ({ company: s.companies.setOpportunities(params[0], (await body(req, obj({ opportunities: V.opportunities }))()).opportunities) }));
    add('POST', '/api/prospects/:id/notes', async ({ req, params }) => ({ company: s.companies.addNote(params[0], (await body(req, obj({ content: str(4000, { min: 1 }) }))()).content) }), 201);
    add('POST', '/api/prospects/:id/external-contacts', async ({ req, params }) => {
      const b = await body(req, obj({ channel: oneOf(EXTERNAL_CONTACT_CHANNELS), note: optional(str(MAX_EXTERNAL_NOTE)), occurredAt: optional(nullable(isoDate)) }))();
      return { company: s.companies.recordExternalContact(params[0], { channel: b.channel, note: b.note ?? '', occurredAt: b.occurredAt ?? null }) };
    }, 201);
    add('POST', '/api/prospects/:id/contacts', async ({ req, params }) => ({ company: s.companies.addContact(params[0], (await body(req, obj({ contact: V.contactInput }))()).contact) }), 201);
    add('PUT', '/api/prospects/:id/contacts/:id', async ({ req, params }) => ({ company: s.companies.updateContact(params[0], params[1], (await body(req, obj({ contact: V.contactInput }))()).contact) }));

    // ---- Research ----
    add('GET', '/api/research/jobs', () => s.research.list());
    add('PUT', '/api/research/jobs/:id', async ({ req, params }) => {
      const { job } = await body(req, obj({ job: V.researchJob }))();
      if (job.id !== params[0]) throw new DataError('invalid_request', 'Gönderilen bilgiler geçersiz.', 'job id mismatch');
      return { job: s.research.saveJob(job) };
    });
    add('PUT', '/api/research/jobs/:id/results', async ({ req, params }) => {
      const { results } = await body(req, obj({ results: arr(V.researchResult, 200) }))();
      return { saved: s.research.saveResults(params[0], results) };
    });
    add('POST', '/api/research/jobs/:id/transfer', async ({ req, params }) => {
      const { resultIds } = await body(req, obj({ resultIds: (v, p) => (v === null || v === undefined ? null : arr(id, 200)(v, p)) }))();
      return s.research.transfer(params[0], resultIds);
    });

    // ---- Mail drafts ----
    add('GET', '/api/mail/drafts', () => ({ drafts: s.mail.list() }));
    add('POST', '/api/mail/drafts/generate', async ({ req, res }) => {
      const options = await body(req, V.generateOptions)();
      const controller = abortOnClose(req, res);
      return { draft: await s.mail.generate(options, controller.signal) };
    });
    add('POST', '/api/mail/drafts/:id/save', async ({ req, params }) => ({ draft: s.mail.save(params[0], (await body(req, obj({ edits: V.draftEdits }))()).edits) }));
    add('POST', '/api/mail/drafts/:id/approve', async ({ req, params }) => ({ draft: s.mail.approve(params[0], (await body(req, obj({ edits: V.draftEdits }))()).edits) }));
  }

  /** Paths this module owns (so a missing store answers 503 instead of 404). */
  const OWNED = /^\/api\/(prospects(\/|$)|research\/jobs(\/|$)|mail\/drafts(\/|$))/;

  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (!OWNED.test(pathname)) return false;
    if (!services) {
      sendDataError(res, 'storage_unavailable');
      return true;
    }
    const route = routes.find((r) => r.method === req.method && r.pattern.test(pathname));
    if (!route) {
      sendDataError(res, 'not_found', 'İstenen işlem bulunamadı.');
      return true;
    }
    const params = (pathname.match(route.pattern) ?? []).slice(1);
    try {
      const result = await route.handler({ req, res, params, body: () => readJson(req, options.maxBodyBytes) });
      if (!res.writableEnded) sendJson(res, route.status ?? 200, result);
    } catch (e) {
      if (res.writableEnded || res.destroyed) return true;
      if (e instanceof DataError) {
        if (e.code === 'invalid_request') console.warn(`[data] ${req.method} ${pathname} rejected: ${e.message}`);
        sendDataError(res, e.code, e.userMessage);
      } else if (e instanceof RequestValidationError) {
        sendDataError(res, 'invalid_request');
      } else if (e instanceof OutreachPrepError) {
        // The compatibility generate endpoint delegates to Phase 13: same codes, same readiness reasons.
        sendJson(res, OUTREACH_PREP_HTTP[e.code], { error: { code: e.code, message: e.message, ...(e.extra.reasons ? { reasons: e.extra.reasons } : {}) } });
      } else if (e instanceof MailSafetyError) {
        console.warn('[mail] draft rejected by safety rules:', e.problems.join(' | '));
        sendJson(res, 422, { error: { code: 'unsafe_output', message: MAIL_ERROR_MESSAGES.unsafe_output, problems: e.problems } });
      } else if (e instanceof ProviderError) {
        const code = (e.code in MAIL_ERROR_MESSAGES ? e.code : 'internal') as MailErrorCode;
        console.warn(`[mail] generation failed: ${e.code}`);
        sendJson(res, MAIL_HTTP[code] ?? 500, { error: { code, message: MAIL_ERROR_MESSAGES[code] } });
      } else {
        // Never log request bodies (mail text, research payloads); the error message is enough.
        console.error(`[data] ${req.method} ${pathname} failed:`, e instanceof Error ? e.message : e);
        sendDataError(res, 'storage_error');
      }
    }
    return true;
  };
}
