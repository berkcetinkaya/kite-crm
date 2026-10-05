// Shared HTTP helpers for the KITE server routes (plain node:http, no framework).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestValidationError } from './research/validateRequest';

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new RequestValidationError('body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new RequestValidationError('invalid JSON');
  }
}

/** Aborts provider/fetch work when the client goes away (cancel button, closed tab). */
export function abortOnClose(req: IncomingMessage, res: ServerResponse): AbortController {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  req.on('aborted', () => controller.abort());
  return controller;
}
