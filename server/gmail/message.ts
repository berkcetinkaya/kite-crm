// MIME building for outgoing mail and normalization of Gmail API messages into plain text.
// Gmail content is untrusted: HTML is converted to text here and never stored or rendered as HTML.
import { parse as parseHtml } from 'node-html-parser';
import type { MailAttachmentMeta } from '../../src/domain/outreach';
import type { GmailThreadMessage, OutgoingMail } from './types';

const MAX_BODY_CHARS = 20_000;

/** Header values never contain line breaks (header injection). */
const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

/** RFC 2047 encoded-word for non-ASCII header text (UTF-8, base64). */
function encodeHeader(v: string): string {
  const clean = oneLine(v);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function encodeAddress(email: string, name: string | null): string {
  const addr = oneLine(email);
  if (!name) return addr;
  const n = oneLine(name).replace(/["\\]/g, '');
  return /^[\x20-\x7e]*$/.test(n) ? `"${n}" <${addr}>` : `${encodeHeader(n)} <${addr}>`;
}

/** An RFC 5322 msg-id: "<local@domain>", nothing else (header values are never free text). */
export const isMessageId = (v: string) => /^<[^<>\s@]+@[^<>\s@]+>$/.test(v.trim());

/**
 * Threading headers for a reply in an existing conversation (RFC 2822/5322 §3.6.4): In-Reply-To is
 * the parent's Message-ID, References the conversation's Message-IDs ending with the parent.
 */
export function threadHeaders(thread: NonNullable<OutgoingMail['thread']>): string[] {
  const parent = oneLine(thread.inReplyTo);
  if (!isMessageId(parent)) throw new Error('invalid In-Reply-To message id');
  const refs = [...thread.references.map(oneLine).filter(isMessageId).filter((r) => r !== parent), parent];
  return [`In-Reply-To: ${parent}`, `References: ${[...new Set(refs)].join(' ')}`];
}

/** Plain text UTF-8 message (base64 body), with the KITE send id as a custom header. */
export function buildMime(mail: OutgoingMail, from: string | null): string {
  const lines = [
    ...(from ? [`From: ${oneLine(from)}`] : []),
    `To: ${encodeAddress(mail.to.email, mail.to.name)}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    ...(mail.thread ? threadHeaders(mail.thread) : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    `X-KITE-Send-Id: ${oneLine(mail.sendId)}`,
    '',
    (Buffer.from(mail.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n'),
  ];
  return lines.join('\r\n');
}

export const toBase64Url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

export function fromBase64Url(data: string | undefined | null): string {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : '';
}

// ---------- Gmail API message → GmailThreadMessage ----------

export interface ApiMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: ApiMessagePart[];
}

export interface ApiMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: ApiMessagePart;
}

export function header(part: ApiMessagePart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

/** Decodes RFC 2047 encoded words (Gmail usually returns decoded headers; this is a fallback). */
function decodeWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _cs: string, enc: string, text: string) => {
    try {
      return enc.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64').toString('utf8')
        : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
    } catch {
      return text;
    }
  });
}

/** "Name <a@b.c>" / "a@b.c" → address parts. */
export function parseAddress(v: string): { email: string; name: string | null } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].trim() ? decodeWords(m[1].trim()) : null };
  return { email: v.trim().replace(/^<|>$/g, '').toLowerCase(), name: null };
}

/** Splits an address list on commas outside quotes/angle brackets. */
export function parseAddressList(v: string | null): string[] {
  if (!v) return [];
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  for (const ch of v) {
    if (ch === '"') quoted = !quoted;
    if (ch === '<') angle = true;
    if (ch === '>') angle = false;
    if (ch === ',' && !quoted && !angle) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => parseAddress(x).email).filter(Boolean);
}

export function htmlToText(html: string): string {
  const root = parseHtml(html);
  root.querySelectorAll('script,style,head').forEach((n) => n.remove());
  return root.structuredText;
}

function walk(part: ApiMessagePart | undefined, visit: (p: ApiMessagePart) => void) {
  if (!part) return;
  visit(part);
  part.parts?.forEach((p) => walk(p, visit));
}

function normalizeText(text: string): string {
  const t = text.replace(/\r\n?/g, '\n').replace(/[^\S\n]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  return t.length > MAX_BODY_CHARS ? `${t.slice(0, MAX_BODY_CHARS)}\n…` : t;
}

/** Plain text of a message: text/plain preferred, HTML converted to text otherwise. */
export function messageText(payload: ApiMessagePart | undefined): string {
  let plain: string | null = null;
  let html: string | null = null;
  walk(payload, (p) => {
    if (p.filename) return;
    if (p.mimeType === 'text/plain' && plain === null && p.body?.data) plain = fromBase64Url(p.body.data);
    if (p.mimeType === 'text/html' && html === null && p.body?.data) html = fromBase64Url(p.body.data);
  });
  return normalizeText(plain ?? (html !== null ? htmlToText(html) : ''));
}

export function attachmentsOf(payload: ApiMessagePart | undefined): MailAttachmentMeta[] {
  const out: MailAttachmentMeta[] = [];
  walk(payload, (p) => {
    if (p.filename) out.push({ filename: oneLine(p.filename).slice(0, 200), mimeType: p.mimeType ?? 'application/octet-stream', size: p.body?.size ?? 0 });
  });
  return out.slice(0, 20);
}

const decodeEntities = (s: string) => htmlToText(`<p>${s}</p>`);

export function normalizeApiMessage(m: ApiMessage): GmailThreadMessage {
  const p = m.payload;
  const date = Number(m.internalDate);
  return {
    id: m.id,
    threadId: m.threadId,
    rfcMessageId: header(p, 'Message-ID') ?? header(p, 'Message-Id'),
    labelIds: m.labelIds ?? [],
    from: parseAddress(header(p, 'From') ?? ''),
    to: parseAddressList(header(p, 'To')),
    cc: parseAddressList(header(p, 'Cc')),
    subject: decodeWords(header(p, 'Subject') ?? '').slice(0, 500),
    bodyText: messageText(p),
    // Gmail snippets are HTML-escaped; store them as text.
    snippet: decodeEntities(m.snippet ?? '').slice(0, 300),
    messageAt: Number.isFinite(date) && date > 0 ? new Date(date).toISOString() : new Date(0).toISOString(),
    attachments: attachmentsOf(p),
  };
}
