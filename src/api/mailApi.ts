// Browser client for mail draft generation. Talks only to our own /api; never to Anthropic.
import { MAIL_ERROR_MESSAGES, type MailErrorBody, type MailErrorCode, type MailGenerateResponse, type MailStatusResponse } from '../domain/mail/api';
import type { MailGenerateRequest } from '../domain/mail/context';

export class MailApiError extends Error {
  constructor(
    public readonly code: MailErrorCode,
    public readonly problems: string[] = [],
  ) {
    super(MAIL_ERROR_MESSAGES[code]);
    this.name = 'MailApiError';
  }
}

async function toApiError(res: Response): Promise<MailApiError> {
  try {
    const body = (await res.json()) as MailErrorBody;
    if (body?.error?.code && body.error.code in MAIL_ERROR_MESSAGES) return new MailApiError(body.error.code, body.error.problems ?? []);
  } catch {
    // Not our JSON (e.g. proxy error page when the server is not running).
  }
  return new MailApiError(res.status === 502 || res.status === 504 || res.status === 404 ? 'server_unreachable' : 'internal');
}

export interface MailApi {
  status(signal?: AbortSignal): Promise<MailStatusResponse>;
  generate(body: MailGenerateRequest, signal?: AbortSignal): Promise<MailGenerateResponse>;
}

export const mailApi: MailApi = {
  async status(signal) {
    let res: Response;
    try {
      res = await fetch('/api/mail/status', { signal });
    } catch {
      throw new MailApiError('server_unreachable');
    }
    if (!res.ok) throw await toApiError(res);
    const body = (await res.json().catch(() => null)) as MailStatusResponse | null;
    if (!body || typeof body.ready !== 'boolean') throw new MailApiError('server_unreachable');
    return body;
  },

  async generate(body, signal) {
    let res: Response;
    try {
      res = await fetch('/api/mail/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (signal?.aborted) throw new MailApiError('cancelled');
      throw new MailApiError('server_unreachable');
    }
    if (!res.ok) throw await toApiError(res);
    return (await res.json()) as MailGenerateResponse;
  },
};
