// Browser client for the mail service status. Talks only to our own /api; never to Anthropic.
// Drafts are generated through /api/outreach-prep (Phase 13).
import { MAIL_ERROR_MESSAGES, type MailErrorBody, type MailErrorCode, type MailStatusResponse } from '../domain/mail/api';

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
};
