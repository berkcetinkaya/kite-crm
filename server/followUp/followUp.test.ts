// Phase 7 follow up tests: planner rules, pre-send live thread check, same-thread sending, reply
// cancellation, idempotency, restart and migration. Fixture Gmail + fixture generator only: no
// network, no real email, no Anthropic. Time is moved with an injectable clock (never real waits).
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_MS, DEFAULT_FOLLOW_UP_SETTINGS, FOLLOW_UP_CANCEL_REASONS, FOLLOW_UP_PAUSE_REASONS, FOLLOW_UP_SEQUENCE_STATUSES, FOLLOW_UP_STEP_STATUSES, statusRule } from '../../src/domain/followUp';
import type { SalesStatus } from '../../src/domain/salesStatus';
import type { ContactInput, NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createApp } from '../app';
import { createClock } from '../clock';
import { loadConfig } from '../config';
import { openStore, type OpenedStore } from '../db/store';
import { MIGRATIONS, runMigrations } from '../db/migrations';
import { openDatabase } from '../db/sqlite';
import { createGmailAdapter } from '../gmail/adapter';
import { createMemoryCredentialStore } from '../gmail/credentialStore';
import { createFixtureGmail, FIXTURE_AUTH_CODE } from '../gmail/fixture';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import type { MailProviderAdapter } from '../mail/provider';
import { createOutreachService, OutreachError } from '../outreach/service';
import { createPersistenceServices } from '../persistence/services';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createFollowUpPlanner, FollowUpError } from './service';

const BASE = Date.parse('2026-10-06T09:00:00.000Z');
const stores: OpenedStore[] = [];
const servers: http.Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  stores.splice(0).forEach((s) => {
    try {
      s.close();
    } catch {
      /* closed by the test */
    }
  });
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

const tmpFile = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kite-fu-'));
  dirs.push(d);
  return path.join(d, 'kite.db');
};

const companyInput = (over: Partial<NewCompanyInput> = {}): NewCompanyInput => ({
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

const contactInput = (email: string | null, over: Partial<ContactInput> = {}): ContactInput => ({
  fullName: 'Dr. Ece Aydın',
  role: 'Klinik Müdürü',
  email,
  phone: null,
  linkedin: null,
  isDecisionMaker: true,
  confidence: 'high',
  ...over,
});

/** Counts every generation call: due detection, listing and restarts must never generate. */
function countingProvider() {
  const inner = createFixtureMailProvider();
  const calls = { generate: 0, followUp: 0 };
  const provider: MailProviderAdapter = {
    id: 'fixture',
    model: null,
    generate: (ctx, s) => {
      calls.generate += 1;
      return inner.generate(ctx, s);
    },
    generateFollowUp: (ctx, s) => {
      calls.followUp += 1;
      return inner.generateFollowUp!(ctx, s);
    },
  };
  return { provider, calls };
}

let keyCounter = 0;
const key = () => `fu_test_key_${(++keyCounter).toString().padStart(8, '0')}`;

interface Opts {
  file?: string;
  email?: string;
  sector?: string;
  settings?: Partial<typeof DEFAULT_FOLLOW_UP_SETTINGS>;
  send?: boolean;
  sendDelayMs?: number;
  name?: string;
}

async function setup(o: Opts = {}) {
  const clock = createClock(0, () => BASE);
  const store = openStore(o.file ?? ':memory:');
  stores.push(store);
  const { provider, calls } = countingProvider();
  const fx = createFixtureGmail({ redirectUri: '/api/gmail/oauth/callback', now: () => clock.now().getTime(), sendDelayMs: o.sendDelayMs });
  const credentials = createMemoryCredentialStore();
  const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials });
  const now = () => clock.now();
  const planner = createFollowUpPlanner(store, { now, mailProvider: provider });
  const data = createPersistenceServices(store, { mailProvider: provider, now, followUps: planner });
  const outreach = createOutreachService(store, gmail, { now, followUps: planner });
  if (o.settings) planner.saveSettings({ ...DEFAULT_FOLLOW_UP_SETTINGS, ...o.settings });
  const { state } = gmail.beginAuthorization();
  await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
  const c0 = data.companies.create(companyInput({ name: o.name ?? 'Kordon Diş Polikliniği', ...(o.sector ? { sector: o.sector } : {}) }));
  const company = data.companies.addContact(c0.id, contactInput(o.email ?? 'ece@kordon-dis.example'));
  const contactId = company.contacts[0].id;
  const draft = await data.mail.generate({ companyId: company.id, service: 'crm', language: 'tr', contactId: null, preserve: null });
  data.mail.approve(draft.id, { selectedSubject: draft.selectedSubject, body: draft.body });
  const t = {
    clock,
    store,
    planner,
    data,
    outreach,
    gmail,
    fx: fx.controls,
    calls,
    company,
    contactId,
    draft,
    advanceDays: (d: number) => clock.setOffsetMs(clock.offsetMs() + d * DAY_MS),
    seq: () => store.followUps.listByCompany(company.id)[0] ?? null,
    current: () => {
      const s = store.followUps.listByCompany(company.id)[0];
      return s.steps.find((x) => x.status === 'scheduled' || x.status === 'prepared' || x.status === 'approved')!;
    },
    async sendFirst() {
      return outreach.send({ draftId: draft.id, companyId: company.id, contactId, idempotencyKey: key() });
    },
    /** Prepare + approve the current step (clock must be at/after its due date). */
    async approveCurrent(edit?: (body: string) => string) {
      const step = t.current();
      const { draft: d } = await planner.prepare(step.id);
      planner.approveDraft(step.id, edit ? edit(d.body) : d.body);
      return t.current();
    },
    sendFollowUp: (stepId: string, k = key()) => outreach.sendFollowUp({ stepId, idempotencyKey: k }),
  };
  if (o.send !== false) await t.sendFirst();
  return t;
}

async function expectCode(p: Promise<unknown> | (() => unknown), code: string) {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    expect(e instanceof FollowUpError || e instanceof OutreachError).toBe(true);
    expect((e as FollowUpError).code).toBe(code);
    return e as FollowUpError;
  }
  throw new Error(`expected ${code}`);
}

describe('settings', () => {
  it('defaults to 3, 7 and 14 days with three steps and follow ups on', async () => {
    const t = await setup({ send: false });
    expect(t.planner.settings()).toEqual({ enabled: true, maxSteps: 3, delays: [3, 7, 14] });
  });

  it('persists in SQLite across restarts and normalizes invalid values', async () => {
    const file = tmpFile();
    const t = await setup({ file, send: false });
    t.planner.saveSettings({ enabled: true, maxSteps: 2, delays: [2, 5, 9] });
    t.store.close();
    const again = openStore(file);
    stores.push(again);
    expect(createFollowUpPlanner(again).settings()).toEqual({ enabled: true, maxSteps: 2, delays: [2, 5, 9] });
    again.settings.set('follow_up', { enabled: 'yes', maxSteps: 9, delays: [0, 500, 3] }, new Date().toISOString());
    expect(createFollowUpPlanner(again).settings()).toEqual({ enabled: true, maxSteps: 3, delays: [3, 7, 3] });
  });
});

describe('sequence creation', () => {
  it('a confirmed first contact send creates the default sequence; step 1 is due 3 days after the confirmed sentAt', async () => {
    const t = await setup();
    const seq = t.seq()!;
    const send = t.store.outreach.getSend(seq.initialOutboundMessageId)!;
    expect(seq).toMatchObject({ status: 'active', currentStep: 1, maxSteps: 3, origin: 'automatic', recipientEmailSnapshot: 'ece@kordon-dis.example', subject: send.subject, gmailThreadId: send.gmailThreadId });
    expect(seq.steps.map((s) => [s.stepNumber, s.delayDays, s.status])).toEqual([[1, 3, 'scheduled'], [2, 7, 'pending'], [3, 14, 'pending']]);
    expect(seq.steps[0].dueAt).toBe(new Date(Date.parse(send.sentAt!) + 3 * DAY_MS).toISOString());
    expect(seq.steps[1].dueAt).toBeNull();
    expect(t.store.companies.get(t.company.id)!.history.some((h) => h.type === 'follow_up' && h.description.startsWith('Takip planı oluşturuldu'))).toBe(true);
  });

  it('uses a custom cadence and step count', async () => {
    const t = await setup({ settings: { maxSteps: 2, delays: [2, 5, 9] } });
    expect(t.seq()!.steps.map((s) => [s.stepNumber, s.delayDays])).toEqual([[1, 2], [2, 5]]);
  });

  it('follow ups off: no automatic sequence; "Takip Planı Oluştur" is offered and refused until turned on', async () => {
    const t = await setup({ settings: { enabled: false } });
    expect(t.seq()).toBeNull();
    expect(t.planner.overview().candidates).toHaveLength(1);
    await expectCode(() => t.planner.createPlan(t.company.id), 'followup_disabled');
    t.planner.saveSettings({ ...DEFAULT_FOLLOW_UP_SETTINGS, enabled: true });
    t.advanceDays(10);
    const view = t.planner.createPlan(t.company.id);
    const send = t.store.outreach.getSend(view.initialOutboundMessageId)!;
    expect(view.origin).toBe('manual');
    // Due date from the confirmed sentAt, even though the plan was created later: due right away.
    expect(view.steps[0].dueAt).toBe(new Date(Date.parse(send.sentAt!) + 3 * DAY_MS).toISOString());
    expect(view.queueGroup).toBe('due');
    await expectCode(() => t.planner.createPlan(t.company.id), 'followup_exists');
    expect(t.planner.overview().candidates).toHaveLength(0);
  });

  it('a failure to create the plan never makes a confirmed send look unsent', async () => {
    const t = await setup({ send: false });
    vi.spyOn(t.planner, 'createAutomatic').mockImplementation(() => {
      throw new Error('disk full');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await t.sendFirst();
    expect(r.send.status).toBe('sent');
    expect(r.followUpWarning).toMatch(/Takip Planı Oluştur/);
    expect(t.store.outreach.getSend(r.send.id)!.status).toBe('sent');
    expect(t.store.companies.get(t.company.id)!.status).toBe('first_contact');
    expect(t.seq()).toBeNull();
    expect(t.planner.overview().candidates.map((c) => c.outboundMessageId)).toEqual([r.send.id]);
  });
});

describe('due detection and the full step flow', () => {
  it('is upcoming before the due date and due after it; preparing early is refused', async () => {
    const t = await setup();
    expect(t.planner.overview().sequences[0]).toMatchObject({ queueGroup: 'upcoming', isDue: false });
    await expectCode(t.planner.prepare(t.current().id), 'followup_not_due');
    t.advanceDays(3);
    expect(t.planner.overview().sequences[0]).toMatchObject({ queueGroup: 'due', isDue: true });
    expect(t.calls.followUp).toBe(0);
  });

  it('prepare → edit → save → approve → send in the same thread; the next step is timed from the confirmed send', async () => {
    const t = await setup();
    const original = t.store.mail.get(t.draft.id)!;
    t.advanceDays(3);
    const step = t.current();
    const { draft } = await t.planner.prepare(step.id);
    expect(draft).toMatchObject({ kind: 'follow_up', status: 'review', selectedSubject: t.seq()!.subject, followUp: { sequenceId: t.seq()!.id, stepNumber: 1 } });
    expect(t.current().status).toBe('prepared');
    const saved = t.planner.saveDraft(step.id, `${draft.body}\n`);
    expect(saved.draft.status).toBe('draft');
    t.planner.approveDraft(step.id, saved.draft.body);
    expect(t.current().status).toBe('approved');

    t.advanceDays(0.5);
    const r = await t.sendFollowUp(step.id);
    const seq = t.seq()!;
    expect(r.send).toMatchObject({ status: 'sent', subject: seq.subject, recipientEmail: 'ece@kordon-dis.example', gmailThreadId: seq.gmailThreadId });
    expect(seq.steps[0]).toMatchObject({ status: 'sent', outboundMessageId: r.send.id });
    expect(seq.steps[1].status).toBe('scheduled');
    expect(seq.steps[1].dueAt).toBe(new Date(Date.parse(r.send.sentAt!) + 7 * DAY_MS).toISOString());
    expect(seq.currentStep).toBe(2);

    // Same Gmail thread, RFC threading headers, original subject.
    const raw = t.fx.rawMessages().at(-1)!;
    const initial = t.store.outreach.getSend(seq.initialOutboundMessageId)!;
    expect(raw).toContain(`In-Reply-To: ${initial.rfcMessageId}`);
    expect(raw).toContain(`References: ${initial.rfcMessageId}`);
    expect(t.fx.delivered().at(-1)!.thread).toEqual({ threadId: seq.gmailThreadId, inReplyTo: initial.rfcMessageId, references: [initial.rfcMessageId] });
    expect(t.fx.delivered().at(-1)!.subject).toBe(initial.subject);
    expect(t.store.outreach.listSendsInThread(seq.gmailThreadId)).toHaveLength(2);

    // Original first contact draft untouched; the generic draft list stays first contact only.
    expect(t.store.mail.get(t.draft.id)).toEqual(original);
    expect(t.store.mail.list().map((d) => d.id)).toEqual([t.draft.id]);
    expect(t.store.mail.listFollowUps()).toHaveLength(1);
    expect(t.store.companies.get(t.company.id)!.history.some((h) => h.type === 'follow_up_sent')).toBe(true);
    expect(t.store.companies.get(t.company.id)!.status).toBe('first_contact');
  });

  it('three follow ups without a reply: one draft per step, all in one thread, then completed', async () => {
    const t = await setup();
    const bodies: string[] = [];
    for (const days of [3, 7, 14]) {
      t.advanceDays(days);
      const step = await t.approveCurrent();
      bodies.push(t.store.mail.get(step.draftId!)!.body);
      await t.sendFollowUp(step.id);
    }
    const seq = t.seq()!;
    expect(seq).toMatchObject({ status: 'completed_no_reply', currentStep: null });
    expect(seq.steps.map((s) => s.status)).toEqual(['sent', 'sent', 'sent']);
    expect(new Set(seq.steps.map((s) => s.draftId)).size).toBe(3);
    expect(t.store.outreach.listSendsInThread(seq.gmailThreadId)).toHaveLength(4);
    expect(new Set(bodies).size).toBe(3);
    // Third message references the whole conversation, parent last.
    const last = t.fx.delivered().at(-1)!.thread!;
    expect(last.references).toHaveLength(3);
    expect(last.inReplyTo).toBe(last.references.at(-1));
  });

  it('second step cannot be prepared while the first is merely approved', async () => {
    const t = await setup();
    t.advanceDays(30);
    await t.approveCurrent();
    const step2 = t.seq()!.steps[1];
    expect(step2).toMatchObject({ status: 'pending', dueAt: null });
    await expectCode(t.planner.prepare(step2.id), 'followup_wrong_state');
  });
});

describe('replies stop follow ups', () => {
  it('reply sync (mixed IMPORTANT/SENT/INBOX alias shape) completes the sequence and blocks the approved draft', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = await t.approveCurrent();
    t.fx.addReply(t.seq()!.gmailThreadId, { shape: 'mixed' });
    const r = await t.outreach.sync();
    expect(r.newMessages).toHaveLength(1);
    const seq = t.seq()!;
    expect(seq).toMatchObject({ status: 'completed_replied', currentStep: null });
    expect(seq.steps.map((s) => [s.status, s.cancelReason])).toEqual([['cancelled', 'reply'], ['cancelled', 'reply'], ['cancelled', 'reply']]);
    expect(t.store.mail.get(step.draftId!)!.status).toBe('approved'); // preserved for the audit history
    await expectCode(t.sendFollowUp(step.id), 'followup_not_active');
    expect(t.fx.sendCalls()).toBe(1);
    expect(t.store.companies.get(t.company.id)!.status).toBe('replied');
  });

  it('pre-send live check: a reply that arrived after approval (not synced yet) is stored and the send is refused', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = await t.approveCurrent();
    // The prospect replies one minute before Berk confirms the send.
    t.clock.setOffsetMs(t.clock.offsetMs() + 60_000);
    t.fx.addReply(t.seq()!.gmailThreadId, { shape: 'reply', at: t.clock.now().getTime() - 60_000 });
    const e = await expectCode(t.sendFollowUp(step.id), 'followup_reply_found');
    expect(e.message).toMatch(/yeni bir yanıt bulundu/);
    expect((e.extra.newMessages as unknown[]).length).toBe(1);
    expect(t.fx.sendCalls()).toBe(1);
    expect(t.store.outreach.listSends()).toHaveLength(1);
    expect(t.seq()!.status).toBe('completed_replied');
    expect(t.store.companies.get(t.company.id)!.status).toBe('replied');
    expect(t.store.outreach.listThreadMessages(t.seq()!.gmailThreadId).filter((m) => m.direction === 'inbound')).toHaveLength(1);
  });

  it('pre-send check also catches the mixed SENT/INBOX alias reply shape', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = await t.approveCurrent();
    t.fx.addReply(t.seq()!.gmailThreadId, { shape: 'mixed' });
    await expectCode(t.sendFollowUp(step.id), 'followup_reply_found');
    expect(t.fx.sendCalls()).toBe(1);
  });

  it('alias self chatter in the thread is not a reply: the follow up is sent', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = await t.approveCurrent();
    t.fx.addReply(t.seq()!.gmailThreadId, { shape: 'self' });
    const r = await t.sendFollowUp(step.id);
    expect(r.send.status).toBe('sent');
    expect(t.store.outreach.listThreadMessages(t.seq()!.gmailThreadId).filter((m) => m.direction === 'inbound')).toHaveLength(0);
  });

  it('a reply after Follow Up 1 stops steps 2 and 3', async () => {
    const t = await setup();
    t.advanceDays(3);
    const s1 = await t.approveCurrent();
    await t.sendFollowUp(s1.id);
    t.advanceDays(2);
    t.fx.addReply(t.seq()!.gmailThreadId);
    await t.outreach.sync();
    expect(t.seq()!.steps.map((s) => s.status)).toEqual(['sent', 'cancelled', 'cancelled']);
    expect(t.seq()!.status).toBe('completed_replied');
  });

  it('Gmail cannot be checked → no send (fail safe); the sequence stays active', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = await t.approveCurrent();
    t.fx.failReads(true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expectCode(t.sendFollowUp(step.id), 'followup_check_failed');
    expect(t.fx.sendCalls()).toBe(1);
    expect(t.store.outreach.listSends()).toHaveLength(1);
    expect(t.seq()!.status).toBe('active');
    t.fx.failReads(false);
    expect((await t.sendFollowUp(step.id)).send.status).toBe('sent');
  });

  it('Gmail disconnected or revoked → no send', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = await t.approveCurrent();
    t.fx.revokeExternally();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(t.sendFollowUp(step.id)).rejects.toThrow();
    await t.gmail.disconnect();
    await expectCode(t.sendFollowUp(step.id), 'gmail_not_connected');
    expect(t.fx.sendCalls()).toBe(1);
  });
});

describe('Berk actions', () => {
  it('Ertele: stores the new date, keeps the original, not due until then; past dates are refused', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = t.current();
    const original = step.dueAt!;
    const later = new Date(t.clock.now().getTime() + 4 * DAY_MS).toISOString();
    const v = t.planner.postpone(step.id, later);
    expect(v.steps[0]).toMatchObject({ dueAt: later, originalDueAt: original });
    expect(v.steps[0].postponedAt).not.toBeNull();
    expect(v.queueGroup).toBe('upcoming');
    expect(t.seq()!.steps.map((s) => s.delayDays)).toEqual([3, 7, 14]);
    await expectCode(() => t.planner.postpone(step.id, new Date(t.clock.now().getTime() - 1000).toISOString()), 'followup_invalid_date');
    t.advanceDays(4);
    expect(t.planner.overview().sequences[0].queueGroup).toBe('due');
  });

  it('Adımı Atla: nothing is sent; the next step is timed from the skip; skipping the last completes', async () => {
    const t = await setup({ settings: { maxSteps: 2 } });
    t.advanceDays(5);
    const skippedAt = t.clock.now().toISOString();
    const v = t.planner.skip(t.current().id);
    expect(v.steps.map((s) => s.status)).toEqual(['skipped', 'scheduled']);
    expect(v.steps[1].dueAt).toBe(new Date(Date.parse(skippedAt) + 7 * DAY_MS).toISOString());
    t.advanceDays(1);
    const done = t.planner.skip(t.current().id);
    expect(done).toMatchObject({ status: 'completed_no_reply', currentStep: null });
    expect(t.fx.sendCalls()).toBe(1);
  });

  it('Takibi Durdur: remaining steps cancelled, reason kept, drafts preserved, sales status unchanged', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = await t.approveCurrent();
    const v = t.planner.stop(t.seq()!.id, 'Telefonda konuştuk');
    expect(v).toMatchObject({ status: 'stopped', stoppedBy: 'berk', stopReason: 'Telefonda konuştuk' });
    expect(v.steps.every((s) => s.status === 'cancelled' && s.cancelReason === 'stopped')).toBe(true);
    expect(t.store.mail.get(step.draftId!)).not.toBeNull();
    expect(t.store.companies.get(t.company.id)!.status).toBe('first_contact');
    await expectCode(t.sendFollowUp(step.id), 'followup_not_active');
    expect(t.planner.overview().sequences[0].queueGroup).toBe('finished');
  });

  it('turning follow ups off pauses active sequences; turning them on does not resume them silently', async () => {
    const t = await setup();
    t.planner.saveSettings({ ...DEFAULT_FOLLOW_UP_SETTINGS, enabled: false });
    expect(t.seq()).toMatchObject({ status: 'paused', pauseReason: 'settings_disabled' });
    await expectCode(() => t.planner.resume(t.seq()!.id), 'followup_disabled');
    t.planner.saveSettings({ ...DEFAULT_FOLLOW_UP_SETTINGS, enabled: true });
    expect(t.seq()!.status).toBe('paused');
    t.advanceDays(3);
    await expectCode(t.planner.prepare(t.current().id), 'followup_not_active');
    expect(t.planner.resume(t.seq()!.id).status).toBe('active');
    expect(t.store.followUps.list()).toHaveLength(1); // nothing deleted
  });
});

describe('sales status rules', () => {
  it('Şimdilik Bekle pauses (not deleted); resume only manually and only from an eligible status', async () => {
    const t = await setup();
    t.data.companies.changeStatus(t.company.id, 'later');
    expect(t.seq()).toMatchObject({ status: 'paused', pauseReason: 'status_later' });
    await expectCode(() => t.planner.resume(t.seq()!.id), 'followup_blocked');
    t.data.companies.changeStatus(t.company.id, 'first_contact');
    expect(t.seq()!.status).toBe('paused');
    expect(t.planner.resume(t.seq()!.id).status).toBe('active');
  });

  it.each(['not_interested', 'disqualified', 'lost', 'meeting', 'proposal', 'awaiting_decision', 'client'] as SalesStatus[])('%s stops the sequence and the status is never moved', async (status) => {
    const t = await setup();
    t.data.companies.changeStatus(t.company.id, status);
    expect(t.seq()).toMatchObject({ status: 'stopped', stoppedBy: 'system' });
    expect(t.store.companies.get(t.company.id)!.status).toBe(status);
    t.data.companies.changeStatus(t.company.id, 'first_contact');
    expect(t.seq()!.status).toBe('stopped'); // never resumed automatically
  });

  it('Yanıt Geldi set by hand (no stored reply) stops the sequence', async () => {
    const t = await setup();
    t.data.companies.changeStatus(t.company.id, 'replied');
    expect(t.seq()!.status).toBe('stopped');
  });

  it('status rule table', () => {
    expect(['found', 'researched', 'first_contact'].map((s) => statusRule(s as SalesStatus))).toEqual(['continue', 'continue', 'continue']);
    expect(statusRule('later')).toBe('pause');
    expect(statusRule('replied')).toBe('reply');
  });

  it('a company already in an advanced stage gets no automatic sequence', async () => {
    const t = await setup({ send: false });
    t.data.companies.changeStatus(t.company.id, 'proposal');
    await t.sendFirst();
    expect(t.seq()).toBeNull();
    expect(t.planner.overview().candidates).toHaveLength(0);
  });
});

describe('blockers', () => {
  it('an unresolved (ambiguous) send blocks preparing and sending until resolved', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = await t.approveCurrent();
    // Simulate an unclear send of this conversation (e.g. a server stop mid-send).
    const initial = t.store.outreach.getSend(t.seq()!.initialOutboundMessageId)!;
    const stuck = { ...initial, id: 'snd_stuck_000001', draftId: step.draftId!, status: 'ambiguous' as const, gmailMessageId: null, gmailThreadId: null, rfcMessageId: null, sentAt: null };
    t.store.outreach.insertSend(stuck, 'stuck_key_0000000001');
    const v = t.planner.overview().sequences[0];
    expect(v.effectiveStatus).toBe('blocked');
    expect(v.queueGroup).toBe('attention');
    await expectCode(t.sendFollowUp(step.id), 'followup_blocked');
    t.outreach.markNotSent(stuck.id);
    expect(t.planner.overview().sequences[0].effectiveStatus).toBe('active');
    expect((await t.sendFollowUp(step.id)).send.status).toBe('sent');
  });

  it('recipient continuity: a changed or removed address blocks; another contact is never used instead', async () => {
    const t = await setup();
    t.advanceDays(3);
    t.data.companies.addContact(t.company.id, contactInput('mert@kordon-dis.example', { fullName: 'Mert Kaya' }));
    expect(t.planner.overview().sequences[0].effectiveStatus).toBe('active');
    t.data.companies.updateContact(t.company.id, t.contactId, contactInput(null));
    const v = t.planner.overview().sequences[0];
    expect(v.effectiveStatus).toBe('blocked');
    expect(v.blockers.join(' ')).toMatch(/ece@kordon-dis.example/);
    await expectCode(t.planner.prepare(t.current().id), 'followup_blocked');
    t.data.companies.updateContact(t.company.id, t.contactId, contactInput('ece@kordon-dis.example'));
    const step = await t.approveCurrent();
    const r = await t.sendFollowUp(step.id);
    expect(r.send.recipientEmail).toBe('ece@kordon-dis.example');
  });
});

describe('idempotency', () => {
  it('a repeated request (double click) never sends twice', async () => {
    const t = await setup();
    t.advanceDays(3);
    const step = await t.approveCurrent();
    const k = key();
    const a = await t.sendFollowUp(step.id, k);
    const b = await t.sendFollowUp(step.id, k);
    expect(b.replayed).toBe(true);
    expect(b.send.id).toBe(a.send.id);
    expect(t.fx.sendCalls()).toBe(2);
  });

  it('two simultaneous requests with different keys: exactly one Gmail submission', async () => {
    const t = await setup({ sendDelayMs: 30 });
    t.advanceDays(3);
    const step = await t.approveCurrent();
    const results = await Promise.allSettled([t.sendFollowUp(step.id), t.sendFollowUp(step.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    // Refused either by the planner's in-flight blocker or by the send record check; never sent twice.
    expect(['send_in_progress', 'already_sent', 'followup_wrong_state', 'followup_blocked']).toContain((rejected.reason as OutreachError).code);
    expect(t.fx.sendCalls()).toBe(2);
    expect(t.store.outreach.listSendsForDraft(step.draftId!)).toHaveLength(1);
  });

  it('a timed out follow up becomes "Kontrol gerekiyor", is never retried, and blocks the sequence', async () => {
    const t = await setup({ email: 'ece+timeout@kordon-dis.example', send: false });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // First contact times out but was delivered: reconcile records it (and creates the plan).
    const failed = await t.sendFirst().then(() => null, (e: OutreachError) => e.extra.send as { id: string });
    const rec = await t.outreach.reconcile(failed!.id);
    expect(rec.found).toBe(true);
    t.advanceDays(3);
    const step = await t.approveCurrent();
    await expectCode(t.sendFollowUp(step.id), 'send_ambiguous');
    const calls = t.fx.sendCalls();
    await expectCode(t.sendFollowUp(step.id), 'followup_blocked');
    expect(t.fx.sendCalls()).toBe(calls);
    const stuck = t.store.outreach.listSendsForDraft(step.draftId!)[0];
    const found = await t.outreach.reconcile(stuck.id);
    expect(found.found).toBe(true);
    expect(t.seq()!.steps[0].status).toBe('sent');
    expect(t.seq()!.steps[1].status).toBe('scheduled');
  });
});

describe('restart and cost safety', () => {
  it('state survives a restart: same due date, no draft generated, nothing sent', async () => {
    const file = tmpFile();
    const t = await setup({ file });
    const dueAt = t.seq()!.steps[0].dueAt;
    t.store.close();
    const again = openStore(file);
    stores.push(again);
    const { provider, calls } = countingProvider();
    const planner = createFollowUpPlanner(again, { now: () => new Date(BASE + 10 * DAY_MS), mailProvider: provider });
    expect(planner.reconcileAll()).toBe(0);
    const o = planner.overview();
    expect(o.sequences[0].steps[0].dueAt).toBe(dueAt);
    expect(o.sequences[0].queueGroup).toBe('due');
    expect(calls).toEqual({ generate: 0, followUp: 0 });
    expect(again.mail.listFollowUps()).toHaveLength(0);
    expect(again.outreach.listSends()).toHaveLength(1);
  });

  it('no automatic paid generation: due detection, listing, clock moves and sync never call the model', async () => {
    const t = await setup();
    const before = { ...t.calls };
    for (let i = 0; i < 40; i++) {
      t.advanceDays(1);
      t.planner.overview();
      t.planner.reconcileAll();
    }
    await t.outreach.sync();
    expect(t.calls).toEqual(before);
    await t.planner.prepare(t.current().id);
    expect(t.calls.followUp).toBe(before.followUp + 1);
  });

  it('a custom sector prepares a valid, general follow up', async () => {
    const t = await setup({ sector: 'Drone ile Tarım İlaçlama' });
    t.advanceDays(3);
    const { draft } = await t.planner.prepare(t.current().id);
    expect(draft.generationNotes.personalization).toBe('general');
    expect(draft.body.split(/\s+/).length).toBeLessThanOrEqual(140);
  });
});

describe('migration from Phase 6', () => {
  it('literal enumerations in the v3 schema match the follow up domain', () => {
    const list = (v: readonly string[]) => v.map((x) => `'${x}'`).join(',');
    const sql = MIGRATIONS.find((m) => m.version === 3)!.sql;
    for (const values of [FOLLOW_UP_SEQUENCE_STATUSES, FOLLOW_UP_STEP_STATUSES, FOLLOW_UP_CANCEL_REASONS, FOLLOW_UP_PAUSE_REASONS]) expect(sql).toContain(list(values));
  });

  it('upgrades a Phase 6 database (company, approved draft, sent mail, thread, reply) without data loss', () => {
    const file = tmpFile();
    const db = openDatabase(file);
    runMigrations(db, MIGRATIONS.slice(0, 2));
    const at = '2026-10-05T19:05:29.597Z';
    db.prepare(`INSERT INTO companies (id, name, website, website_host, name_key, sector, sector_id, city, country, country_key, source, status, created_at, updated_at)
      VALUES ('cmp_p6', 'KITE Gmail Test', NULL, NULL, 'kite gmail test', 'Danışmanlık', NULL, 'İstanbul', 'Türkiye', 'TR', 'manual', 'replied', ?, ?)`).run(at, at);
    db.prepare(`INSERT INTO mail_drafts (id, company_id, contact_id, service, language, subject_options_json, selected_subject, body, status, research_job_id,
      evidence_refs_json, sector_context_json, generation_notes_json, edited_since_generation, created_at, updated_at, generated_at, approved_at)
      VALUES ('mail_p6', 'cmp_p6', NULL, 'website', 'tr', '["Konu"]', 'Konu', 'Metin', 'approved', NULL, '[]', '{}', '{}', 0, ?, ?, ?, ?)`).run(at, at, at, at);
    db.prepare(`INSERT INTO mail_draft_versions (draft_id, position, subject, body, saved_at, reason) VALUES ('mail_p6', 0, 'Eski', 'Eski metin', ?, 'before_regeneration')`).run(at);
    db.prepare(`INSERT INTO outbound_messages (id, idempotency_key, company_id, draft_id, contact_id, revision_key, recipient_email, recipient_name, from_email, subject, body,
      service, language, provider, status, gmail_message_id, gmail_thread_id, rfc_message_id, attempted_at, sent_at, created_at, updated_at)
      VALUES ('snd_p6', 'send_key_p6_000000001', 'cmp_p6', 'mail_p6', NULL, 'rk', 'berk@example.com', NULL, 'hello@kitegrowth.com', 'Konu', 'Metin',
      'website', 'tr', 'gmail', 'sent', 'g1', 'th1', '<a@mail.gmail.com>', ?, ?, ?, ?)`).run(at, at, at, at);
    for (const [id, gid, dir] of [['msg_o', 'g1', 'outbound'], ['msg_i', 'g4', 'inbound']] as const) {
      db.prepare(`INSERT INTO mail_messages (id, outbound_id, company_id, gmail_thread_id, gmail_message_id, rfc_message_id, direction, from_email, from_name, to_json, cc_json,
        subject, body_text, snippet, message_at, synced_at, attachments_json) VALUES (?, 'snd_p6', 'cmp_p6', 'th1', ?, NULL, ?, 'x@example.com', NULL, '[]', '[]', 'Konu', 'ok', 'ok', ?, ?, '[]')`).run(id, gid, dir, at, at);
    }
    db.close();

    const s = openStore(file);
    stores.push(s);
    expect(s.schemaVersion).toBe(3);
    expect(s.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(s.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    const draft = s.mail.get('mail_p6')!;
    expect(draft).toMatchObject({ status: 'approved', body: 'Metin', selectedSubject: 'Konu' });
    expect(draft.kind).toBeUndefined();
    expect(draft.previousVersions).toHaveLength(1);
    expect(s.mail.getByCompany('cmp_p6')!.id).toBe('mail_p6');
    expect(s.outreach.getSend('snd_p6')!.status).toBe('sent');
    expect(s.outreach.listMessages()).toHaveLength(2);
    expect(s.followUps.list()).toEqual([]); // never created retroactively
    // Replied conversation: not offered for a plan.
    expect(createFollowUpPlanner(s).overview().candidates).toEqual([]);
    // Still one first contact draft per company.
    expect(() => s.db.prepare(`INSERT INTO mail_drafts (id, company_id, kind, service, language, subject_options_json, selected_subject, body, status, evidence_refs_json,
      sector_context_json, generation_notes_json, created_at, updated_at, generated_at) VALUES ('mail_dup', 'cmp_p6', 'first_contact', 'crm', 'tr', '[]', '', '', 'review', '[]', '{}', '{}', ?, ?, ?)`).run(at, at, at)).toThrow(/UNIQUE/);
  });

  it('a Phase 6 send without a reply is offered for "Takip Planı Oluştur" (no automatic plan)', async () => {
    const t = await setup({ settings: { enabled: false } });
    t.planner.saveSettings({ ...DEFAULT_FOLLOW_UP_SETTINGS, enabled: true });
    expect(t.seq()).toBeNull();
    expect(t.planner.overview().candidates).toHaveLength(1);
  });
});

describe('HTTP layer', () => {
  async function start(t: Awaited<ReturnType<typeof setup>>) {
    const config = { ...loadConfig({}), testControls: false };
    const server = http.createServer(createApp({ config, provider: null, mailProvider: null, data: t.data, outreach: t.outreach, followUps: t.planner, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const post = (base: string, p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('lists follow ups, refuses cross-site mutations and replays a repeated send', async () => {
    const t = await setup();
    const base = await start(t);
    const list = (await (await fetch(`${base}/api/follow-ups`)).json()) as { overview: { sequences: unknown[]; settings: unknown } };
    expect(list.overview.sequences).toHaveLength(1);
    expect((await post(base, `/api/follow-ups/sequences/${t.seq()!.id}/stop`, { reason: null }, { origin: 'https://evil.example' })).status).toBe(403);
    t.advanceDays(3);
    const step = await t.approveCurrent();
    const k = key();
    const a = (await (await post(base, `/api/follow-ups/steps/${step.id}/send`, { idempotencyKey: k })).json()) as { send: { id: string }; replayed: boolean };
    const b = (await (await post(base, `/api/follow-ups/steps/${step.id}/send`, { idempotencyKey: k })).json()) as { send: { id: string }; replayed: boolean };
    expect(b.replayed).toBe(true);
    expect(b.send.id).toBe(a.send.id);
    expect(t.fx.sendCalls()).toBe(2);
  });

  it('generic draft endpoints refuse follow up drafts; test controls do not exist outside fixture test mode', async () => {
    const t = await setup();
    t.advanceDays(3);
    const { draft } = await t.planner.prepare(t.current().id);
    const base = await start(t);
    expect((await post(base, `/api/mail/drafts/${draft.id}/approve`, { edits: { selectedSubject: 'Yeni konu', body: draft.body } })).status).toBe(404);
    expect((await post(base, '/api/test/clock', { advanceDays: 5 })).status).toBe(404);
    expect(loadConfig({ KITE_TEST_CONTROLS: '1', KITE_GMAIL_PROVIDER: 'fixture' }).testControls).toBe(false);
    expect(loadConfig({ KITE_TEST_CONTROLS: '1', RESEARCH_PROVIDER: 'fixture' }).testControls).toBe(false);
    expect(loadConfig({ KITE_TEST_CONTROLS: '1', RESEARCH_PROVIDER: 'fixture', KITE_GMAIL_PROVIDER: 'fixture' }).testControls).toBe(true);
  });

  it('a reply found by the pre-send check is reported in Turkish with the fresh state', async () => {
    const t = await setup();
    const base = await start(t);
    t.advanceDays(3);
    const step = await t.approveCurrent();
    t.fx.addReply(t.seq()!.gmailThreadId);
    const res = await post(base, `/api/follow-ups/steps/${step.id}/send`, { idempotencyKey: key() });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string }; overview: { sequences: { status: string }[] } };
    expect(body.error.code).toBe('followup_reply_found');
    expect(body.error.message).toMatch(/gönderilmedi/);
    expect(body.overview.sequences[0].status).toBe('completed_replied');
  });
});
