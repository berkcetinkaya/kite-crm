// Phase 6 send + reply tests: service rules against the fixture Gmail (no network), plus the HTTP
// layer for duplicate requests and same-origin protection. No real Gmail, no Anthropic.
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SalesStatus } from '../../src/domain/salesStatus';
import { statusAfterReply, statusAfterSend } from '../../src/domain/outreach';
import type { ContactInput, NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { openStore, type OpenedStore } from '../db/store';
import { createGmailAdapter } from '../gmail/adapter';
import { createMemoryCredentialStore } from '../gmail/credentialStore';
import { createFixtureGmail, FIXTURE_ACCOUNT, FIXTURE_AUTH_CODE } from '../gmail/fixture';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { createPersistenceServices } from '../persistence/services';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createOutreachService, isInboundReply, OutreachError } from './service';
import type { GmailThreadMessage } from '../gmail/types';

const stores: OpenedStore[] = [];
const servers: http.Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  stores.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

const company = (over: Partial<NewCompanyInput> = {}): NewCompanyInput => ({
  name: 'Kordon Diş Polikliniği',
  website: 'kordon-dis.example',
  sector: 'Diş Kliniği',
  city: 'İzmir',
  country: 'Türkiye',
  source: 'manual',
  opportunities: [{ service: 'crm', score: 80, potential: 'high', reason: 'Randevu takibi' }],
  opportunityScore: 80,
  status: 'researched',
  owner: 'Berk Çetinkaya',
  note: '',
  ...over,
});

const contact = (email: string | null, over: Partial<ContactInput> = {}): ContactInput => ({
  fullName: 'Dr. Ece Aydın',
  role: 'Klinik Müdürü',
  email,
  phone: null,
  linkedin: null,
  isDecisionMaker: true,
  confidence: 'high',
  ...over,
});

async function setup(options: { connect?: boolean; email?: string | null; status?: SalesStatus; file?: string; sendDelayMs?: number } = {}) {
  const store = openStore(options.file ?? ':memory:');
  stores.push(store);
  const credentials = createMemoryCredentialStore();
  const fx = createFixtureGmail({ redirectUri: '/api/gmail/oauth/callback', sendDelayMs: options.sendDelayMs });
  const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials });
  const data = createPersistenceServices(store, { mailProvider: createFixtureMailProvider() });
  const outreach = createOutreachService(store, gmail);
  if (options.connect !== false) {
    const { state } = gmail.beginAuthorization();
    await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
  }
  const c0 = data.companies.create(company({ status: options.status ?? 'researched' }));
  const c = data.companies.addContact(c0.id, contact(options.email === undefined ? 'ece@kordon-dis.example' : options.email));
  const generated = await data.mail.generate({ companyId: c.id, service: 'crm', language: 'tr', contactId: null, preserve: null });
  const approve = () => data.mail.approve(generated.id, { selectedSubject: generated.selectedSubject, body: generated.body });
  return { store, data, outreach, gmail, fx, credentials, company: c, contactId: c.contacts[0].id, draft: generated, approve };
}

let keyCounter = 0;
const key = () => `idem_test_key_${(++keyCounter).toString().padStart(6, '0')}`;

async function expectOutreachError(p: Promise<unknown> | (() => unknown), code: string) {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    expect(e).toBeInstanceOf(OutreachError);
    expect((e as OutreachError).code).toBe(code);
    return e as OutreachError;
  }
  throw new Error(`expected ${code}`);
}

describe('status transitions', () => {
  it('send moves early stages to İlk Temas and never backwards', () => {
    expect(statusAfterSend('found')).toBe('first_contact');
    expect(statusAfterSend('researched')).toBe('first_contact');
    for (const s of ['first_contact', 'replied', 'meeting', 'proposal', 'awaiting_decision', 'client', 'not_interested', 'lost', 'later', 'disqualified'] as const) expect(statusAfterSend(s)).toBe(s);
  });
  it('reply moves stages before Yanıt Geldi to it; later stages and side states stay', () => {
    for (const s of ['found', 'researched', 'first_contact'] as const) expect(statusAfterReply(s)).toBe('replied');
    for (const s of ['replied', 'meeting', 'proposal', 'awaiting_decision', 'client', 'not_interested', 'lost', 'later', 'disqualified'] as const) expect(statusAfterReply(s)).toBe(s);
  });
});

describe('send eligibility', () => {
  it('never sends an unapproved draft (İncelenecek or Taslak)', async () => {
    const t = await setup();
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'draft_not_approved');
    t.data.mail.save(t.draft.id, { selectedSubject: t.draft.selectedSubject, body: `${t.draft.body}\nEk.` });
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'draft_not_approved');
    expect(t.fx.controls.sendCalls()).toBe(0);
    expect(t.store.outreach.listSends()).toEqual([]);
  });

  it('rejects a missing recipient, a contact without email and an invalid email', async () => {
    const t = await setup({ email: null });
    t.approve();
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: 'ct_unknown', idempotencyKey: key() }), 'recipient_missing');
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'recipient_invalid');
    const withBad = t.data.companies.addContact(t.company.id, contact('ece at kordon', { fullName: 'Ece' }));
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: withBad.contacts[1].id, idempotencyKey: key() }), 'recipient_invalid');
    expect(t.fx.controls.sendCalls()).toBe(0);
  });

  it('rejects a draft of another company and a disconnected Gmail', async () => {
    const t = await setup({ connect: false });
    t.approve();
    const other = t.data.companies.create(company({ name: 'Başka Klinik', website: 'baska.example' }));
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: other.id, contactId: t.contactId, idempotencyKey: key() }), 'gmail_not_connected');
    const { state } = t.gmail.beginAuthorization();
    await t.gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: other.id, contactId: t.contactId, idempotencyKey: key() }), 'draft_company_mismatch');
    expect(t.fx.controls.sendCalls()).toBe(0);
  });
});

describe('successful send', () => {
  it('persists the exact snapshot, Gmail ids, history, last contact and İlk Temas', async () => {
    const t = await setup();
    const approved = t.approve();
    const out = await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
    expect(out.send).toMatchObject({ status: 'sent', recipientEmail: 'ece@kordon-dis.example', recipientName: 'Dr. Ece Aydın', fromEmail: FIXTURE_ACCOUNT, subject: approved.selectedSubject, body: approved.body, provider: 'fixture', draftId: t.draft.id });
    expect(out.send.gmailMessageId).toBeTruthy();
    expect(out.send.gmailThreadId).toBeTruthy();
    expect(out.send.rfcMessageId).toMatch(/^<.+>$/);
    expect(out.company.status).toBe('first_contact');
    expect(out.company.lastContactAt).toBe(out.send.sentAt);
    expect(out.company.history.slice(0, 2).map((h) => h.type).sort()).toEqual(['email_sent', 'status_changed']);
    expect(out.company.history.find((h) => h.type === 'email_sent')!.description).toContain('ece@kordon-dis.example');
    expect(out.company.history.some((h) => h.type === 'status_changed' && h.description.includes('İlk Temas'))).toBe(true);
    expect(t.store.companies.get(t.company.id)!.status).toBe('first_contact');
    expect(t.fx.controls.delivered()).toHaveLength(1);
    // KITE's own message is stored as the outbound side of the thread.
    expect(t.store.outreach.listMessages()).toMatchObject([{ direction: 'outbound', gmailMessageId: out.send.gmailMessageId }]);
    // The approved draft is kept unchanged.
    expect(t.store.mail.get(t.draft.id)).toMatchObject({ status: 'approved', body: approved.body });
  });

  it('later draft edits never change the sent snapshot; the draft cannot be sent twice', async () => {
    const t = await setup();
    const approved = t.approve();
    const out = await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
    t.data.mail.save(t.draft.id, { selectedSubject: 'Yeni konu', body: 'Tamamen yeni metin' });
    t.data.mail.approve(t.draft.id, { selectedSubject: 'Yeni konu', body: 'Tamamen yeni metin' });
    expect(t.store.outreach.getSend(out.send.id)).toMatchObject({ subject: approved.selectedSubject, body: approved.body });
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'already_sent');
    expect(t.fx.controls.sendCalls()).toBe(1);
  });

  it('does not downgrade an advanced pipeline status or reopen side states', async () => {
    for (const status of ['meeting', 'proposal', 'client', 'not_interested', 'lost'] as const) {
      const t = await setup({ status });
      t.approve();
      const out = await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
      expect(out.company.status).toBe(status);
      expect(out.company.history[0].type).toBe('email_sent');
      expect(out.company.history.some((h) => h.type === 'status_changed' && h.createdAt === out.send.sentAt)).toBe(false);
    }
  });
});

describe('failures and duplicates', () => {
  it('provider rejection: failed record, no CRM change, draft kept, retry allowed after inspection', async () => {
    const t = await setup({ email: 'reject@kordon-dis.example' });
    t.approve();
    const before = t.store.companies.get(t.company.id)!;
    const err = await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'send_rejected');
    expect(err.status).toBe(502);
    expect((err.extra.send as { status: string }).status).toBe('failed');
    const after = t.store.companies.get(t.company.id)!;
    expect(after.status).toBe(before.status);
    expect(after.lastContactAt).toBe(before.lastContactAt);
    expect(after.history).toEqual(before.history);
    expect(t.store.mail.get(t.draft.id)!.status).toBe('approved');
    expect(t.store.outreach.listMessages()).toEqual([]);
    // A confirmed failure frees the draft: Berk may explicitly try again.
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'send_rejected');
    expect(t.fx.controls.sendCalls()).toBe(2);
  });

  it('ambiguous result: no success, no CRM change, never retried automatically; reconcile finds a delivered mail', async () => {
    const t = await setup({ email: 'timeout@kordon-dis.example' });
    t.approve();
    const err = await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'send_ambiguous');
    const send = err.extra.send as { id: string; status: string };
    expect(send.status).toBe('ambiguous');
    expect(t.store.companies.get(t.company.id)!.status).toBe('researched');
    expect(t.fx.controls.sendCalls()).toBe(1);
    // Another send request is blocked until it is reviewed.
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'needs_review');
    expect(t.fx.controls.sendCalls()).toBe(1);
    const rec = await t.outreach.reconcile(send.id);
    expect(rec.found).toBe(true);
    expect(rec.send).toMatchObject({ status: 'sent', resolution: 'reconciled' });
    expect(rec.company.status).toBe('first_contact');
    expect(t.fx.controls.sendCalls()).toBe(1);
  });

  it('ambiguous and not delivered: reconcile finds nothing, Berk marks it not sent, then may send again', async () => {
    const t = await setup({ email: 'lost@kordon-dis.example' });
    t.approve();
    const err = await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'send_ambiguous');
    const id = (err.extra.send as { id: string }).id;
    const rec = await t.outreach.reconcile(id);
    expect(rec.found).toBe(false);
    expect(rec.send.status).toBe('ambiguous');
    expect(t.outreach.markNotSent(id)).toMatchObject({ status: 'failed', resolution: 'marked_not_sent' });
    expect(() => t.outreach.markNotSent(id)).toThrow(OutreachError);
    await expectOutreachError(t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() }), 'send_ambiguous');
    expect(t.fx.controls.sendCalls()).toBe(2);
  });

  it('the same idempotency key (browser/server retry) returns the first result and never sends again', async () => {
    const t = await setup();
    t.approve();
    const k = key();
    const first = await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: k });
    const again = await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: k });
    expect(again.replayed).toBe(true);
    expect(again.send.id).toBe(first.send.id);
    expect(t.fx.controls.sendCalls()).toBe(1);
  });

  it('double click: two concurrent requests with different keys send exactly once', async () => {
    const t = await setup({ sendDelayMs: 50 });
    t.approve();
    const req = () => t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
    const results = await Promise.allSettled([req(), req(), req()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const codes = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => (r.reason as OutreachError).code);
    expect(codes.every((c) => c === 'send_in_progress' || c === 'already_sent')).toBe(true);
    expect(t.fx.controls.sendCalls()).toBe(1);
    expect(t.fx.controls.delivered()).toHaveLength(1);
  });

  it('a send interrupted by a server stop becomes "needs review" on the next start', async () => {
    const t = await setup();
    t.approve();
    const at = new Date().toISOString();
    t.store.outreach.insertSend(
      { id: 'snd_interrupted', companyId: t.company.id, draftId: t.draft.id, contactId: t.contactId, recipientEmail: 'ece@kordon-dis.example', recipientName: null, fromEmail: null, subject: 's', body: 'b', service: 'crm', language: 'tr', revisionKey: 'x', provider: 'fixture', status: 'sending', gmailMessageId: null, gmailThreadId: null, rfcMessageId: null, errorCode: null, errorMessage: null, resolution: null, attemptedAt: at, sentAt: null, createdAt: at, updatedAt: at },
      'idem_interrupted_000001',
    );
    expect(t.outreach.recoverInterrupted().sends).toBe(1);
    expect(t.store.outreach.getSend('snd_interrupted')).toMatchObject({ status: 'ambiguous', resolution: 'interrupted' });
  });
});

describe('reply synchronization', () => {
  it('persists a new reply once, ignores own messages, moves to Yanıt Geldi', async () => {
    const t = await setup({ email: 'ece.replies@kordon-dis.example' });
    t.approve();
    await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
    const first = await t.outreach.sync();
    expect(first.run).toMatchObject({ status: 'ok', threadsChecked: 1, newReplies: 2 });
    expect(first.newMessages.every((m) => m.direction === 'inbound' && m.fromEmail === 'ece.replies@kordon-dis.example')).toBe(true);
    // The fixture thread also contains another message from Berk's own account: not a reply.
    expect(first.newMessages.some((m) => m.bodyText.includes('takvim davetini'))).toBe(false);
    const c = t.store.companies.get(t.company.id)!;
    expect(c.status).toBe('replied');
    expect(c.history.filter((h) => h.type === 'reply_received')).toHaveLength(2);
    // Untrusted content is kept as text (markup stays literal text, never parsed as HTML).
    expect(first.newMessages[0].bodyText).toContain('<b>HTML değil, düz metin.</b>');
    expect(first.newMessages[0].attachments).toEqual([{ filename: 'tanitim.pdf', mimeType: 'application/pdf', size: 48213 }]);
    const second = await t.outreach.sync();
    expect(second.run.newReplies).toBe(0);
    expect(t.store.outreach.listMessages().filter((m) => m.direction === 'inbound')).toHaveLength(2);
    expect(t.store.companies.get(t.company.id)!.history.filter((h) => h.type === 'reply_received')).toHaveLength(2);
    expect(t.store.outreach.lastSuccessfulSyncRun()?.id).toBe(second.run.id);
  });

  it('a thread with no reply stores nothing and keeps İlk Temas', async () => {
    const t = await setup();
    t.approve();
    await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
    const r = await t.outreach.sync();
    expect(r.run.newReplies).toBe(0);
    expect(t.store.companies.get(t.company.id)!.status).toBe('first_contact');
  });

  it('a company already in Görüşme or a side state is not moved by a reply', async () => {
    for (const status of ['meeting', 'not_interested', 'lost'] as const) {
      const t = await setup({ email: 'reply@kordon-dis.example', status });
      t.approve();
      await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
      const r = await t.outreach.sync();
      expect(r.run.newReplies).toBe(1);
      const c = t.store.companies.get(t.company.id)!;
      expect(c.status).toBe(status);
      expect(c.history[0].type).toBe('reply_received');
    }
  });

  it('a revoked Gmail grant fails the sync with a reconnect error and is recorded', async () => {
    const t = await setup({ email: 'reply@kordon-dis.example' });
    t.approve();
    await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
    t.fx.controls.revokeExternally();
    await expectOutreachError(t.outreach.sync(), 'gmail_reconnect');
    expect(t.store.outreach.lastSyncRun()).toMatchObject({ status: 'failed', errorCode: 'gmail_reconnect' });
    expect((await t.outreach.status()).state).toBe('error');
  });

  it('send history and replies survive a server restart (same database file)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kite-outreach-'));
    dirs.push(dir);
    const file = path.join(dir, 'kite.db');
    const t = await setup({ file, email: 'reply@kordon-dis.example' });
    t.approve();
    const out = await t.outreach.send({ draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
    await t.outreach.sync();
    const before = { sends: t.store.outreach.listSends(), messages: t.store.outreach.listMessages(), company: t.store.companies.get(t.company.id) };
    t.store.close();
    stores.splice(stores.indexOf(t.store), 1);
    const reopened = openStore(file);
    stores.push(reopened);
    expect(reopened.outreach.listSends()).toEqual(before.sends);
    expect(reopened.outreach.listMessages()).toEqual(before.messages);
    expect(reopened.companies.get(t.company.id)).toEqual(before.company);
    expect(reopened.outreach.getSend(out.send.id)!.status).toBe('sent');
  });
});

describe('outreach HTTP API', () => {
  async function serve(t: Awaited<ReturnType<typeof setup>>) {
    const config = loadConfig({ RESEARCH_PROVIDER: 'fixture', KITE_GMAIL_PROVIDER: 'fixture' });
    const server = http.createServer(createApp({ config, provider: null, data: t.data, outreach: t.outreach, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return async (method: string, p: string, body?: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) => {
      const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as Record<string, any> };
    };
  }

  it('duplicate HTTP requests send once; cross-site and non-JSON posts are refused', async () => {
    const t = await setup({ sendDelayMs: 30 });
    t.approve();
    const call = await serve(t);
    const body = { draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() };
    // Same key twice at once (browser retry): the second gets the first request's record.
    const [a, b] = await Promise.all([call('POST', '/api/outreach/send', body), call('POST', '/api/outreach/send', body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
    expect(a.body.send.id).toBe(b.body.send.id);
    // A different key (second click after the first finished) is refused: already sent.
    const second = await call('POST', '/api/outreach/send', { ...body, idempotencyKey: key() });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('already_sent');
    const replay = await call('POST', '/api/outreach/send', body);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(t.fx.controls.sendCalls()).toBe(1);

    const forged = await call('POST', '/api/outreach/sync', {}, { 'content-type': 'application/json', origin: 'https://evil.example' });
    expect(forged.status).toBe(403);
    const form = await call('POST', '/api/outreach/sync', {}, { 'content-type': 'text/plain' });
    expect(form.status).toBe(403);

    const list = await call('GET', '/api/outreach');
    expect(list.body.sends).toHaveLength(1);
    const status = await call('GET', '/api/gmail/status');
    expect(status.body).toMatchObject({ provider: 'fixture', state: 'connected', email: FIXTURE_ACCOUNT });
    expect(JSON.stringify(status.body)).not.toMatch(/fixture-(refresh|access)-/);
  });

  it('validates the send body and reports Turkish errors', async () => {
    const t = await setup();
    const call = await serve(t);
    const bad = await call('POST', '/api/outreach/send', { draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: 'short' });
    expect(bad.status).toBe(400);
    const unapproved = await call('POST', '/api/outreach/send', { draftId: t.draft.id, companyId: t.company.id, contactId: t.contactId, idempotencyKey: key() });
    expect(unapproved.status).toBe(409);
    expect(unapproved.body.error).toMatchObject({ code: 'draft_not_approved', message: expect.stringContaining('onaylanmış') });
  });

  it('OAuth callback: state must match the cookie and the server record; tokens never reach the browser', async () => {
    const t = await setup({ connect: false });
    const call = await serve(t);
    const start = await call('POST', '/api/gmail/connect', {});
    expect(start.status).toBe(200);
    const cookie = start.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const authUrl = new URL(start.body.authUrl, 'http://x');
    const state = authUrl.searchParams.get('state')!;
    // Without the cookie (another browser / CSRF): rejected.
    const noCookie = await call('GET', `/api/gmail/oauth/callback?code=${FIXTURE_AUTH_CODE}&state=${state}`, undefined, {});
    expect(noCookie.status).toBe(302);
    expect(noCookie.headers.get('location')).toBe('/#/settings?gmail=error&code=oauth_state');
    // The state was consumed by the failed attempt: even with the cookie it cannot be reused.
    const reused = await call('GET', `/api/gmail/oauth/callback?code=${FIXTURE_AUTH_CODE}&state=${state}`, undefined, { cookie: `kite_gmail_oauth=${state}` });
    expect(reused.headers.get('location')).toContain('code=oauth_state');
    const fresh = await call('POST', '/api/gmail/connect', {});
    const state2 = new URL(fresh.body.authUrl, 'http://x').searchParams.get('state')!;
    const ok = await call('GET', `/api/gmail/oauth/callback?code=${FIXTURE_AUTH_CODE}&state=${state2}`, undefined, { cookie: `kite_gmail_oauth=${state2}` });
    expect(ok.headers.get('location')).toBe('/#/settings?gmail=connected');
    expect(t.credentials.peek()).toMatchObject({ email: FIXTURE_ACCOUNT, provider: 'fixture' });
    const status = await call('GET', '/api/gmail/status');
    expect(status.body.state).toBe('connected');
    expect(JSON.stringify(status.body)).not.toContain(t.credentials.peek()!.refreshToken);
    const off = await call('POST', '/api/gmail/disconnect', {});
    expect(off.body.state).toBe('disconnected');
    expect(t.credentials.peek()).toBeNull();
  });
});

describe('live Gmail shape: recipient is an alias of the connected mailbox', () => {
  // Phase 6.1 live thread: the contact address is one of the connected mailbox's own identities,
  // so Gmail labels the contact's reply SENT as well as INBOX. Only a message from the stored
  // recipient that is addressed back to the connected account is a reply.
  const ALIAS = 'berk.alias@kite-fixture.example';

  async function aliasSetup(status: SalesStatus = 'researched') {
    const store = openStore(':memory:');
    stores.push(store);
    const fx = createFixtureGmail({ redirectUri: '/api/gmail/oauth/callback' });
    let thread: (threadId: string, outboundId: string) => GmailThreadMessage[] = () => [];
    const api = { ...fx.api, getThread: async (_token: string, threadId: string) => thread(threadId, sentId) };
    let sentId = '';
    const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api, credentials: createMemoryCredentialStore() });
    const { state } = gmail.beginAuthorization();
    await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
    const data = createPersistenceServices(store, { mailProvider: createFixtureMailProvider() });
    const outreach = createOutreachService(store, gmail);
    const c0 = data.companies.create(company({ status }));
    const c = data.companies.addContact(c0.id, contact(ALIAS));
    const draft = await data.mail.generate({ companyId: c.id, service: 'crm', language: 'tr', contactId: null, preserve: null });
    data.mail.approve(draft.id, { selectedSubject: draft.selectedSubject, body: draft.body });
    const out = await outreach.send({ draftId: draft.id, companyId: c.id, contactId: c.contacts[0].id, idempotencyKey: key() });
    sentId = out.send.gmailMessageId!;
    return { store, outreach, company: c, out, setThread: (fn: typeof thread) => (thread = fn) };
  }

  const msg = (over: Partial<GmailThreadMessage> & Pick<GmailThreadMessage, 'id' | 'threadId'>): GmailThreadMessage => ({
    rfcMessageId: `<${over.id}@mail.gmail.com>`,
    labelIds: [],
    from: { email: FIXTURE_ACCOUNT, name: null },
    to: [],
    cc: [],
    subject: 'Re: konu',
    bodyText: 'metin',
    snippet: 'metin',
    messageAt: '2026-10-05T12:00:00.000Z',
    attachments: [],
    ...over,
  });

  function liveThread(threadId: string, outboundId: string): GmailThreadMessage[] {
    return [
      // 1. KITE's own send (stored id), Gmail shows it in SENT and INBOX (alias delivery).
      msg({ id: outboundId, threadId, labelIds: ['SENT', 'INBOX'], from: { email: FIXTURE_ACCOUNT, name: 'Berk' }, to: [ALIAS] }),
      // 2. Alias self-chatter from the recipient identity, not addressed to the connected account.
      msg({ id: 'live-msg-2', threadId, labelIds: ['SENT', 'INBOX'], from: { email: ALIAS, name: 'Berk' }, to: [ALIAS] }),
      // 3. Manual message from the connected account to the alias.
      msg({ id: 'live-msg-3', threadId, labelIds: ['SENT'], from: { email: FIXTURE_ACCOUNT, name: 'Berk' }, to: [ALIAS] }),
      // 4. The real reply: from the stored recipient, addressed to the connected account.
      msg({ id: 'live-msg-4', threadId, labelIds: ['IMPORTANT', 'SENT', 'INBOX'], from: { email: ALIAS, name: 'Test Kişisi' }, to: [FIXTURE_ACCOUNT], bodyText: 'Merhaba, görüşelim.' }),
      // A draft from the recipient identity addressed to the account never counts.
      msg({ id: 'live-msg-5', threadId, labelIds: ['DRAFT'], from: { email: ALIAS, name: null }, to: [FIXTURE_ACCOUNT] }),
    ];
  }

  it('stores exactly the one real reply even though Gmail labels it SENT; no duplicate on resync', async () => {
    const t = await aliasSetup();
    t.setThread(liveThread);
    const first = await t.outreach.sync();
    expect(first.run).toMatchObject({ status: 'ok', newReplies: 1 });
    expect(first.newMessages.map((m) => m.gmailMessageId)).toEqual(['live-msg-4']);
    expect(first.newMessages[0]).toMatchObject({ direction: 'inbound', fromEmail: ALIAS, bodyText: 'Merhaba, görüşelim.' });
    const c = t.store.companies.get(t.company.id)!;
    expect(c.status).toBe('replied');
    expect(c.history.filter((h) => h.type === 'reply_received')).toHaveLength(1);
    const second = await t.outreach.sync();
    expect(second.run.newReplies).toBe(0);
    expect(t.store.outreach.listMessages().filter((m) => m.direction === 'inbound').map((m) => m.gmailMessageId)).toEqual(['live-msg-4']);
    expect(t.store.companies.get(t.company.id)!.history.filter((h) => h.type === 'reply_received')).toHaveLength(1);
  });

  it('the same reply does not move a company that is already past Yanıt Geldi', async () => {
    const t = await aliasSetup('meeting');
    t.setThread(liveThread);
    expect((await t.outreach.sync()).run.newReplies).toBe(1);
    expect(t.store.companies.get(t.company.id)!.status).toBe('meeting');
  });

  it('rule details: SENT alone is not proof of an own message; self-chatter and drafts never count', () => {
    const ctx = { ownIds: new Set(['own-1']), account: FIXTURE_ACCOUNT, send: { recipientEmail: ALIAS } };
    const base = { id: 'x', from: { email: ALIAS, name: null }, cc: [] as string[] };
    expect(isInboundReply({ ...base, labelIds: ['IMPORTANT', 'SENT', 'INBOX'], to: [FIXTURE_ACCOUNT] }, ctx)).toBe(true);
    expect(isInboundReply({ ...base, labelIds: ['SENT', 'INBOX'], to: [], cc: [FIXTURE_ACCOUNT.toUpperCase()] }, ctx)).toBe(true);
    expect(isInboundReply({ ...base, labelIds: ['SENT', 'INBOX'], to: [ALIAS] }, ctx)).toBe(false);
    expect(isInboundReply({ ...base, id: 'own-1', labelIds: ['SENT', 'INBOX'], to: [FIXTURE_ACCOUNT] }, ctx)).toBe(false);
    expect(isInboundReply({ ...base, labelIds: ['DRAFT'], to: [FIXTURE_ACCOUNT] }, ctx)).toBe(false);
    expect(isInboundReply({ ...base, labelIds: ['SENT'], from: { email: FIXTURE_ACCOUNT, name: null }, to: [ALIAS] }, ctx)).toBe(false);
    // Unchanged: an ordinary inbound message (no SENT label, not from the account) still counts.
    expect(isInboundReply({ ...base, labelIds: ['INBOX'], from: { email: 'ece@klinik.example', name: null }, to: [FIXTURE_ACCOUNT] }, { ...ctx, send: { recipientEmail: 'ece@klinik.example' } })).toBe(true);
  });
});
