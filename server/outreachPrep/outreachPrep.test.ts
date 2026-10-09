// Phase 13: schema v8, prepared draft generation (fixture provider only), repair retry, manual-edit
// protection, partial regeneration, alternatives, batch, the daily cap, the first-contact send guard,
// the legacy generate gate and the HTTP layer. No Anthropic, no real Gmail.
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResearchResult, ServiceSignal } from '../../src/domain/research';
import type { ContactInput, NewCompanyInput } from '../../src/state/companies/companyCommands';
import { GENERAL_INTRO } from '../../src/domain/outreachAngles';
import type { Company } from '../../src/domain/company';
import { planManualEmail } from '../../src/domain/manualContact';
import { createApp } from '../app';
import { createClock } from '../clock';
import { loadConfig } from '../config';
import { MIGRATIONS, runMigrations } from '../db/migrations';
import { openDatabase, type Db } from '../db/sqlite';
import { createStore, openStore, type OpenedStore } from '../db/store';
import { asSchemaVersion, sampleJob, sampleResult, seedFirstContactDraft } from '../db/testFixtures';
import { createFollowUpPlanner } from '../followUp/service';
import { createGmailAdapter } from '../gmail/adapter';
import { createMemoryCredentialStore } from '../gmail/credentialStore';
import { createFixtureGmail, FIXTURE_AUTH_CODE } from '../gmail/fixture';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { MailSafetyError } from '../mail/generate';
import type { MailProviderAdapter } from '../mail/provider';
import { createOutreachService, OutreachError } from '../outreach/service';
import { createPersistenceServices } from '../persistence/services';
import { fixtureFetcher } from '../research/fixtureProvider';
import { createTaskService } from '../tasks/service';
import { createOutreachPrepService, OutreachPrepError } from './service';

const BASE = Date.parse('2026-10-07T09:00:00.000Z');
const stores: OpenedStore[] = [];
const dbs: Db[] = [];
const servers: http.Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  stores.splice(0).forEach((s) => s.close());
  dbs.splice(0).forEach((d) => {
    try {
      d.close();
    } catch {
      /* closed */
    }
  });
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const companyInput = (name: string, over: Partial<NewCompanyInput> = {}): NewCompanyInput => ({
  name,
  website: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example`,
  sector: 'Diş Kliniği',
  city: 'İzmir',
  country: 'Türkiye',
  source: 'manual',
  opportunities: [{ service: 'crm', score: 80, potential: 'high', reason: '' }],
  opportunityScore: 80,
  status: 'researched',
  owner: 'Berk Çetinkaya',
  note: '',
  ...over,
});
const contactInput = (email: string | null, over: Partial<ContactInput> = {}): ContactInput => ({ fullName: 'Dr. Ece Aydın', role: 'Klinik Müdürü', email, phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high', ...over });
const signal = (key: string, origin: ServiceSignal['origin'], evidenceIds: string[] = []): ServiceSignal => ({ key, label: key, state: 'positive', reason: 'not', evidenceIds, origin, weight: 1 });

function setup(opts: { provider?: MailProviderAdapter; maxReal?: number } = {}) {
  const store = openStore(':memory:');
  stores.push(store);
  const clock = createClock(0, () => BASE);
  const now = () => clock.now();
  const mailProvider = opts.provider ?? createFixtureMailProvider();
  const followUps = createFollowUpPlanner(store, { now, mailProvider });
  // Same wiring as server/index.ts: one generation authority shared with the compatibility endpoint.
  const prep = createOutreachPrepService(store, { now, mailProvider, maxRealGenerationsPerDay: opts.maxReal ?? 30 });
  const data = createPersistenceServices(store, { now, mailProvider, followUps, outreachPrep: prep });
  const fx = createFixtureGmail({ redirectUri: '/cb', now: () => clock.now().getTime() });
  const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials: createMemoryCredentialStore() });
  const outreach = createOutreachService(store, gmail, { now, followUps });
  /** A CRM company with a contact; with research (two CRM angles) unless research is false. */
  const add = (name: string, o: { research?: boolean; email?: string | null; over?: Partial<NewCompanyInput>; signals?: ServiceSignal[]; phase12?: boolean } = {}) => {
    const c0 = data.companies.create(companyInput(name, o.over));
    const c = o.email === null ? c0 : data.companies.addContact(c0.id, contactInput(o.email ?? `ece@${c0.website}`));
    if (o.research !== false) {
      const jobId = `rsch_${c.id}`;
      store.research.saveJob(sampleJob({ id: jobId }));
      const result: ResearchResult = sampleResult({
        id: `res_${c.id}`,
        researchRequestId: jobId,
        companyName: c.name,
        website: `https://${c.website}/`,
        transferredCompanyId: c.id,
        alreadyInProspects: true,
        serviceOpportunities: [
          { service: 'crm', score: 80, confidence: 'high', recommendation: 'primary', reason: '', evidenceIds: [], signals: o.signals ?? [signal('booking_flow', 'check'), signal('whatsapp_contact', 'analysis', ['w1']), signal('high_touch_sales', 'analysis', ['w1'])] },
        ],
      });
      store.research.saveResults(jobId, [result]);
      if (o.phase12) {
        store.discovery.saveDetails({ jobId, provider: 'fixture', filters: { familyId: null, website: 'has', contactRequired: false, language: 'any', size: 'any' }, searchQueries: [], searchesUsed: 0, plannedMaxSearches: 1, plannedMaxInspections: 1, createdAt: new Date(BASE).toISOString(), updatedAt: new Date(BASE).toISOString() });
      }
    }
    return store.companies.get(c.id)!;
  };
  const connect = async () => {
    const { state } = gmail.beginAuthorization();
    await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
  };
  return { store, clock, data, prep, outreach, followUps, add, connect, gmail };
}

async function expectCode<T>(p: Promise<T> | (() => T), code: string) {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    expect((e as { code?: string }).code).toBe(code);
    return e as OutreachPrepError;
  }
  throw new Error(`expected ${code}`);
}

const fingerprint = (db: Db, tables: string[]) => Object.fromEntries(tables.map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())]));

describe('schema v8', () => {
  it('fresh install includes v8 and its outreach_preparations table (later migrations are additive)', () => {
    const s = openStore(':memory:');
    stores.push(s);
    expect(s.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    expect(MIGRATIONS.find((m) => m.version === 8)).toMatchObject({ name: 'outreach_preparation' });
    expect(s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'outreach_preparations'").get()).toBeTruthy();
  });

  it('upgrades a Phase 12 database (companies, research, review, drafts, sends, reply, follow-ups, tasks) without changing any row', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kite-p13-'));
    dirs.push(dir);
    const file = path.join(dir, 'kite.db');
    const db = openDatabase(file);
    dbs.push(db);
    runMigrations(db, MIGRATIONS.filter((m) => m.version <= 7));
    const store = asSchemaVersion(createStore(db), 7);
    const clock = createClock(0, () => BASE);
    const now = () => clock.now();
    const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
    const data = createPersistenceServices(store, { now, mailProvider: createFixtureMailProvider(), followUps: planner });
    const fx = createFixtureGmail({ redirectUri: '/cb', now: () => clock.now().getTime() });
    const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials: createMemoryCredentialStore() });
    const { state } = gmail.beginAuthorization();
    await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
    const outreach = createOutreachService(store, gmail, { now, followUps: planner });
    for (const [name, email] of [['Replied Co', 'a@replied.example'], ['Waiting Co', 'a@waiting.example']] as const) {
      const c0 = data.companies.create(companyInput(name));
      const c = data.companies.addContact(c0.id, contactInput(email));
      const d = seedFirstContactDraft(store, c.id, { at: now().toISOString() });
      data.mail.approve(d.id, { selectedSubject: d.selectedSubject, body: d.body });
      await outreach.send({ draftId: d.id, companyId: c.id, contactId: c.contacts[0].id, idempotencyKey: `idem_p13_${name.replace(/\W/g, '')}_0001` });
    }
    fx.controls.addReply(store.outreach.listThreadSends().find((s) => s.recipientEmail === 'a@replied.example')!.gmailThreadId!, { shape: 'reply' });
    await outreach.sync();
    store.research.saveJob(sampleJob());
    store.research.saveResults('rsch_1', [sampleResult()]);
    store.discovery.saveReview({ resultId: 'res_1', status: 'fit', rejectReason: null, notes: 'n', sector: null, sectorId: null, services: ['crm'], contacts: null, duplicateAcks: [], reviewedAt: new Date(BASE).toISOString(), updatedAt: new Date(BASE).toISOString() });
    createTaskService(store, { now }).create({ title: 'Eski görev', notes: '', priority: 'normal', dueAt: null, dueHasTime: false, owner: null, companyId: null, customerId: null });
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toHaveLength(26);
    const before = fingerprint(db, tables);
    for (const t of ['companies', 'mail_drafts', 'outbound_messages', 'mail_messages', 'follow_up_sequences', 'research_results', 'candidate_reviews', 'tasks']) expect(JSON.parse(before[t]).length, t).toBeGreaterThan(0);
    db.close();
    const s = openStore(file);
    stores.push(s);
    expect(s.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    expect(fingerprint(s.db, tables)).toEqual(before);
    expect(s.db.prepare('SELECT COUNT(*) n FROM outreach_preparations').get()).toEqual({ n: 0 });
    expect(s.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(s.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(runMigrations(s.db)).toEqual({ applied: [], version: MIGRATIONS.at(-1)!.version });
  });

  it('constraints: tone and JSON checks, cascade with the company, SET NULL with the draft', async () => {
    const t = setup();
    const c = t.add('Constraint Clinic');
    await t.prep.generate(c.id, { mode: 'full' });
    expect(() => t.store.db.prepare("UPDATE outreach_preparations SET tone = 'loud'").run()).toThrow();
    expect(() => t.store.db.prepare("UPDATE outreach_preparations SET claim_map_json = 'nope'").run()).toThrow();
    t.store.db.prepare('DELETE FROM mail_drafts WHERE company_id = ?').run(c.id);
    expect(t.store.outreachPrep.get(c.id)!.draftId).toBeNull();
    t.store.db.prepare('DELETE FROM companies WHERE id = ?').run(c.id);
    expect(t.store.outreachPrep.get(c.id)).toBeNull();
  });
});

describe('generation', () => {
  it('a Hazır company gets a validated draft (İncelenecek) and a preparation record; nothing is approved, sent or planned', async () => {
    const t = setup();
    const c = t.add('Aurora Dental');
    const d = await t.prep.generate(c.id, { mode: 'full' });
    expect(d.draft!.status).toBe('review');
    expect(d.draft!.generationNotes.promptVersion).toBe('mail-v2');
    expect(d.draft!.generationNotes.personalization).toBe('specific');
    expect(d.draft!.body).toMatch(/^Merhaba Dr\. Ece Aydın,/);
    expect(d.draft!.body).toContain('Sitenize baktığımda rezervasyon veya randevu taleplerini online aldığınızı gördüm.');
    expect(d.draft!.evidenceRefs.map((e) => e.id)).toContain('w1');
    const p = d.preparation!;
    expect(p).toMatchObject({ draftId: d.draft!.id, service: 'crm', angleKey: 'enquiry_handling', tone: 'premium', ctaKey: 'share_ideas', provider: 'fixture', promptVersion: 'mail-v2' });
    expect(p.claims.every((cl) => cl.sourceIds.length > 0)).toBe(true);
    expect(p.sections.map((s) => s.key)).toEqual(['opening', 'observation', 'value', 'cta']);
    expect(p.readinessSnapshot?.state).toBe('ready');
    expect(p.contactSnapshot?.email).toBe('ece@aurora-dental.example');
    expect(t.store.outreach.listSends()).toEqual([]);
    expect(t.store.followUps.list()).toEqual([]);
    expect(t.prep.realGenerations().today).toBe(0);
  });

  it('not Hazır: refused with reasons and nothing saved', async () => {
    const t = setup();
    const manual = t.add('Manual Co', { research: false });
    const err = await expectCode(t.prep.generate(manual.id, { mode: 'full' }), 'not_ready');
    expect(err.extra.reasons!.map((r) => r.code)).toEqual(['no_angle']);
    const lost = t.add('Lost Co', { over: { status: 'lost' } });
    await expectCode(t.prep.generate(lost.id, { mode: 'full' }), 'not_ready');
    expect(t.store.mail.list()).toEqual([]);
    expect(t.store.outreachPrep.list()).toEqual([]);
  });

  it('a manual company becomes Hazır only with an explicit Genel tanıtım; the draft makes no company claims', async () => {
    const t = setup();
    const c = t.add('Manual Clinic', { research: false });
    expect(t.prep.detail(c.id).readiness.state).toBe('missing');
    expect(t.prep.updatePreparation(c.id, { angleKey: GENERAL_INTRO }).readiness.state).toBe('ready');
    const d = await t.prep.generate(c.id, { mode: 'full' });
    expect(d.draft!.generationNotes.personalization).toBe('general');
    expect(d.preparation!.sections.find((s) => s.key === 'observation')!.text).toBe('');
    expect(d.preparation!.claims).toEqual([]);
    expect(d.draft!.body).not.toMatch(/gördüm|Sitenize/);
  });

  it('a Phase 12 candidate without an Uygun review is İnceleme Gerekli; a legacy transfer is not', () => {
    const t = setup();
    const p12 = t.add('Phase Twelve Clinic', { phase12: true });
    expect(t.prep.detail(p12.id).readiness.reasons.map((r) => r.code)).toEqual(['candidate_unreviewed']);
    const legacy = t.add('Legacy Clinic');
    expect(t.prep.detail(legacy.id).readiness.state).toBe('ready');
  });

  it('one automatic repair: the first invalid output is fixed with the exact problems', async () => {
    const t = setup();
    const c = t.add('Unsafe Once Clinic');
    const d = await t.prep.generate(c.id, { mode: 'full' });
    expect(d.draft!.generationNotes.warnings.join()).toMatch(/bir kez düzeltilerek/);
    expect(d.draft!.body).not.toMatch(/%20/);
  });

  it('a second invalid output is rejected with the reasons; nothing is saved', async () => {
    const t = setup();
    const c = t.add('Always Unsafe Clinic');
    const err = await t.prep.generate(c.id, { mode: 'full' }).catch((e) => e);
    expect(err).toBeInstanceOf(MailSafetyError);
    expect((err as MailSafetyError).problems.join()).toMatch(/manuel bir kayda dayanmadan|iddia haritasında yok/);
    expect(t.store.mail.getByCompany(c.id)).toBeNull();
    expect(t.store.outreachPrep.get(c.id)).toBeNull();
  });

  it('manual edits are never overwritten silently; replaceEdits archives the edited text', async () => {
    const t = setup();
    const c = t.add('Edit Clinic');
    const first = (await t.prep.generate(c.id, { mode: 'full' })).draft!;
    const edited = `${first.body}\n\nNot: elle eklendi.`;
    t.data.mail.save(first.id, { selectedSubject: first.selectedSubject, body: edited });
    await expectCode(t.prep.generate(c.id, { mode: 'full' }), 'edits_present');
    expect(t.store.mail.get(first.id)!.body).toBe(edited);
    const again = await t.prep.generate(c.id, { mode: 'full', replaceEdits: true });
    expect(again.draft!.body).not.toContain('elle eklendi');
    expect(again.draft!.previousVersions[0]).toMatchObject({ body: edited, reason: 'before_regeneration' });
  });

  it('partial regeneration: opening only, CTA only, subject only; untouched content stays exactly', async () => {
    const t = setup();
    const c = t.add('Partial Clinic');
    const first = (await t.prep.generate(c.id, { mode: 'full' })).draft!;
    const sections = t.store.outreachPrep.get(c.id)!.sections;
    const opening = sections.find((s) => s.key === 'opening')!.text;
    const value = sections.find((s) => s.key === 'value')!.text;
    // Berk edits the value section; the opening is regenerated, his edit stays.
    t.data.mail.save(first.id, { selectedSubject: first.selectedSubject, body: first.body.replace(value, 'Benim değer cümlem.') });
    const op = await t.prep.generate(c.id, { mode: 'opening' });
    const newOpening = op.preparation!.sections.find((s) => s.key === 'opening')!.text;
    expect(newOpening).not.toBe(opening);
    expect(op.draft!.body).toContain(newOpening);
    expect(op.draft!.body).toContain('Benim değer cümlem.');
    expect(op.draft!.body).not.toContain(opening);
    expect(op.draft!.editedSinceGeneration).toBe(true);
    expect(op.draft!.status).toBe('review');
    // Subject only: body unchanged byte for byte.
    const bodyBefore = op.draft!.body;
    const sub = await t.prep.generate(c.id, { mode: 'subject' });
    expect(sub.draft!.body).toBe(bodyBefore);
    expect(sub.draft!.subjectOptions).not.toEqual(op.draft!.subjectOptions);
    // CTA only.
    const cta = await t.prep.generate(c.id, { mode: 'cta' });
    expect(cta.draft!.body).toContain('Benim değer cümlem.');
    expect(cta.draft!.body).toContain(newOpening);
    // An edited section cannot be regenerated on its own.
    const ctaText = cta.preparation!.sections.find((s) => s.key === 'cta')!.text;
    t.data.mail.save(first.id, { selectedSubject: cta.draft!.selectedSubject, body: cta.draft!.body.replace(ctaText, 'Kendi kapanışım.') });
    await expectCode(t.prep.generate(c.id, { mode: 'cta' }), 'section_edited');
  });

  it('a subject typed by Berk is kept on subject-only regeneration', async () => {
    const t = setup();
    const c = t.add('Subject Clinic');
    const first = (await t.prep.generate(c.id, { mode: 'full' })).draft!;
    t.data.mail.save(first.id, { selectedSubject: 'Benim konum', body: first.body });
    const sub = await t.prep.generate(c.id, { mode: 'subject' });
    expect(sub.draft!.selectedSubject).toBe('Benim konum');
  });

  it('partial modes need a prepared draft', async () => {
    const t = setup();
    const c = t.add('No Draft Clinic');
    await expectCode(t.prep.generate(c.id, { mode: 'opening' }), 'no_draft');
  });

  it('regenerating an approved draft returns it to İncelenecek (approval stays a separate step)', async () => {
    const t = setup();
    const c = t.add('Approved Clinic');
    const first = (await t.prep.generate(c.id, { mode: 'full' })).draft!;
    t.data.mail.approve(first.id, { selectedSubject: first.selectedSubject, body: first.body });
    const again = await t.prep.generate(c.id, { mode: 'full' });
    expect(again.draft!.status).toBe('review');
    expect(again.draft!.approvedAt).toBeNull();
  });

  it('alternatives: another angle and another tone; using one archives the current text', async () => {
    const t = setup();
    const c = t.add('Variant Clinic');
    const d = await t.prep.generate(c.id, { mode: 'full', variants: true });
    const variants = d.preparation!.variants;
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({ angleKey: 'consultative_sales', tone: 'premium' });
    expect(variants[1]).toMatchObject({ angleKey: 'enquiry_handling', tone: 'direct' });
    const used = t.prep.useVariant(c.id, variants[1].id, false);
    expect(used.draft!.body).toBe(variants[1].body);
    expect(used.draft!.previousVersions[0].body).toBe(d.draft!.body);
    expect(used.preparation!.tone).toBe('direct');
    expect(used.preparation!.variants.map((v) => v.id)).toEqual([variants[0].id]);
  });

  it('preparation patch: angle must fit the service; only probable duplicates can be confirmed', () => {
    const t = setup();
    const c = t.add('Patch Clinic');
    expect(() => t.prep.updatePreparation(c.id, { angleKey: 'findability_basics' })).toThrow(OutreachPrepError);
    expect(() => t.prep.updatePreparation(c.id, { duplicateAcks: ['company:cmp_nope'] })).toThrow(OutreachPrepError);
    expect(t.prep.updatePreparation(c.id, { tone: 'consultative', angleKey: 'consultative_sales' }).readiness).toMatchObject({ tone: 'consultative', angle: { key: 'consultative_sales' } });
  });
});

describe('batch and caps', () => {
  it('at most 5 companies; sequential, isolated, skipped with reasons; never approves or sends', async () => {
    const t = setup();
    await expectCode(t.prep.batch(['a1x', 'a2x', 'a3x', 'a4x', 'a5x', 'a6x']), 'batch_too_large');
    const ready = t.add('Ready Clinic');
    const blocked = t.add('Lost Clinic', { over: { status: 'lost' } });
    const drafted = t.add('Drafted Clinic');
    await t.prep.generate(drafted.id, { mode: 'full' });
    const failing = t.add('Always Unsafe Batch');
    const results = await t.prep.batch([ready.id, blocked.id, drafted.id, failing.id]);
    expect(results.map((r) => [r.companyName, r.status])).toEqual([
      ['Ready Clinic', 'generated'],
      ['Lost Clinic', 'skipped'],
      ['Drafted Clinic', 'skipped'],
      ['Always Unsafe Batch', 'failed'],
    ]);
    expect(results[1].message).toMatch(/Kaybedildi/);
    expect(t.store.mail.list().every((d) => d.status === 'review')).toBe(true);
    expect(t.store.outreach.listSends()).toEqual([]);
    expect(t.store.followUps.list()).toEqual([]);
  });

  it('real generations are capped per İstanbul day (repair attempts count); fixture never counts', async () => {
    const fixture = createFixtureMailProvider();
    const real: MailProviderAdapter = { ...fixture, id: 'anthropic', model: 'test-model' };
    const t = setup({ provider: real, maxReal: 2 });
    const a = t.add('Real One');
    await t.prep.generate(a.id, { mode: 'full' });
    expect(t.prep.realGenerations()).toEqual({ today: 1, limit: 2 });
    const b = t.add('Unsafe Once Real');
    await t.prep.generate(b.id, { mode: 'full' }).catch(() => undefined);
    expect(t.prep.realGenerations().today).toBe(2);
    const c = t.add('Real Three');
    await expectCode(t.prep.generate(c.id, { mode: 'full' }), 'daily_limit');
    t.clock.setOffsetMs(24 * 3_600_000);
    await t.prep.generate(c.id, { mode: 'full' });
    expect(t.prep.realGenerations().today).toBe(1);
  });
});

describe('first-contact send guard (existing send path)', () => {
  async function approved(t: ReturnType<typeof setup>, name: string, over: Partial<NewCompanyInput> = {}) {
    const c = t.add(name, { over });
    const d = (await t.prep.generate(c.id, { mode: 'full' })).draft!;
    t.data.mail.approve(d.id, { selectedSubject: d.selectedSubject, body: d.body });
    return { company: t.store.companies.get(c.id)!, draft: t.store.mail.get(d.id)! };
  }

  it('an allowed company sends normally; the follow up plan is still created by the send (Phase 7)', async () => {
    const t = setup();
    await t.connect();
    const { company, draft } = await approved(t, 'Send Clinic');
    const out = await t.outreach.send({ draftId: draft.id, companyId: company.id, contactId: company.contacts[0].id, idempotencyKey: 'idem_p13_send_000001' });
    expect(out.send.status).toBe('sent');
    expect(t.store.followUps.listByCompany(company.id)).toHaveLength(1);
    expect(t.prep.detail(company.id).readiness.state).toBe('blocked');
  });

  it.each(['lost', 'not_interested', 'disqualified', 'client'] as const)('refuses a new first contact once the company is %s', async (status) => {
    const t = setup();
    await t.connect();
    const { company, draft } = await approved(t, `Guard ${status}`);
    t.data.companies.changeStatus(company.id, status);
    const err = await t.outreach.send({ draftId: draft.id, companyId: company.id, contactId: company.contacts[0].id, idempotencyKey: `idem_p13_${status}_00001` }).catch((e) => e);
    expect(err).toBeInstanceOf(OutreachError);
    expect((err as OutreachError).code).toBe('first_contact_blocked');
    expect((err as OutreachError).status).toBe(409);
    expect(t.store.outreach.listSends()).toEqual([]);
  });

  it('refuses a hard CRM duplicate and an active customer', async () => {
    const t = setup();
    await t.connect();
    const { company, draft } = await approved(t, 'Dup Clinic');
    t.data.companies.create(companyInput('Other Name', { website: company.website }));
    const err = await t.outreach.send({ draftId: draft.id, companyId: company.id, contactId: company.contacts[0].id, idempotencyKey: 'idem_p13_dup_000001' }).catch((e) => e);
    expect((err as OutreachError).code).toBe('first_contact_blocked');
    expect(((err as OutreachError).extra.reasons as { code: string }[])[0].code).toBe('hard_duplicate');
  });

});

describe('compatibility endpoint /api/mail/drafts/generate delegates to the same authority', () => {
  type LegacyOver = Partial<{ service: 'crm' | 'seo'; language: 'tr' | 'en'; contactId: string | null; preserve: { selectedSubject: string; body: string } | null }>;
  const legacy = (t: ReturnType<typeof setup>, companyId: string, over: LegacyOver = {}) =>
    t.data.mail.generate({ companyId, service: 'crm', language: 'tr', contactId: null, preserve: null, ...over });

  it('a Hazır company gets the same prompt v2 draft with claim map and preparation; nothing sent or planned', async () => {
    const t = setup();
    const c = t.add('Legacy Ready');
    const d = await legacy(t, c.id);
    expect(d.generationNotes.promptVersion).toBe('mail-v2');
    expect(d.status).toBe('review');
    const p = t.store.outreachPrep.get(c.id)!;
    expect(p).toMatchObject({ draftId: d.id, service: 'crm', language: 'tr', angleKey: 'enquiry_handling', provider: 'fixture' });
    expect(p.claims.length).toBeGreaterThan(0);
    expect(t.store.outreach.listSends()).toEqual([]);
    expect(t.store.followUps.list()).toEqual([]);
  });

  it('full readiness gate: blocked and Eksik Bilgi companies are refused with reasons; nothing (not even the overrides) is saved', async () => {
    const t = setup();
    const lost = t.add('Legacy Lost', { over: { status: 'lost' } });
    const e1 = await legacy(t, lost.id).catch((e) => e);
    expect(e1).toBeInstanceOf(OutreachPrepError);
    expect((e1 as OutreachPrepError).extra.reasons![0].code).toBe('stage_blocked');
    const manual = t.add('Legacy Manual', { research: false });
    const e2 = await legacy(t, manual.id, { service: 'seo', language: 'en' }).catch((e) => e);
    expect((e2 as OutreachPrepError).code).toBe('not_ready');
    expect((e2 as OutreachPrepError).extra.reasons!.map((r) => r.code)).toEqual(['no_angle']);
    expect(t.store.outreachPrep.list()).toEqual([]);
    expect(t.store.mail.list()).toEqual([]);
  });

  it('same contact and angle rules: an explicit Genel tanıtım choice is honoured, a chosen contact is used', async () => {
    const t = setup();
    const c = t.add('Legacy General', { research: false });
    const second = t.data.companies.addContact(c.id, { fullName: 'Ayşe Demir', role: 'Ortak', email: 'ayse@legacy-general.example', phone: null, linkedin: null, isDecisionMaker: false, confidence: 'medium' });
    t.prep.updatePreparation(c.id, { angleKey: GENERAL_INTRO });
    const ayse = second.contacts.find((x) => x.fullName === 'Ayşe Demir')!;
    const d = await legacy(t, c.id, { contactId: ayse.id, language: 'en' });
    expect(d.body).toMatch(/^Hi Ayşe Demir,/);
    expect(d.generationNotes.personalization).toBe('general');
    expect(t.store.outreachPrep.get(c.id)).toMatchObject({ contactId: ayse.id, language: 'en', angleKey: GENERAL_INTRO });
  });

  it('a different service clears a specific angle (it belongs to its service) and is judged on that service', async () => {
    const t = setup();
    const c = t.add('Legacy Service Switch');
    t.prep.updatePreparation(c.id, { angleKey: 'consultative_sales' });
    const err = await legacy(t, c.id, { service: 'seo' }).catch((e) => e);
    expect((err as OutreachPrepError).extra.reasons!.map((r) => r.code)).toEqual(['no_angle']);
    expect(t.store.outreachPrep.get(c.id)!.angleKey).toBe('consultative_sales');
  });

  it('same edit protection: edits are refused without preserve; preserve replaces them and archives the text', async () => {
    const t = setup();
    const c = t.add('Legacy Edits');
    const first = await legacy(t, c.id);
    const edited = `${first.body}\n\nElle eklendi.`;
    t.data.mail.save(first.id, { selectedSubject: first.selectedSubject, body: edited });
    expect(((await legacy(t, c.id).catch((e) => e)) as OutreachPrepError).code).toBe('edits_present');
    const again = await legacy(t, c.id, { preserve: { selectedSubject: first.selectedSubject, body: edited } });
    expect(again.previousVersions[0].body).toBe(edited);
  });

  it('same claim validation and single repair retry; a second failure saves nothing', async () => {
    const t = setup();
    const once = t.add('Unsafe Once Legacy');
    expect((await legacy(t, once.id)).generationNotes.warnings.join()).toMatch(/bir kez düzeltilerek/);
    const always = t.add('Always Unsafe Legacy');
    expect(await legacy(t, always.id).catch((e) => e)).toBeInstanceOf(MailSafetyError);
    expect(t.store.mail.getByCompany(always.id)).toBeNull();
  });

  it('same real-generation cap (shared counter with /api/outreach-prep)', async () => {
    const fixture = createFixtureMailProvider();
    const real: MailProviderAdapter = { ...fixture, id: 'anthropic', model: 'test-model' };
    const t = setup({ provider: real, maxReal: 1 });
    await t.prep.generate(t.add('Cap One').id, { mode: 'full' });
    expect(((await legacy(t, t.add('Cap Two').id).catch((e) => e)) as OutreachPrepError).code).toBe('daily_limit');
  });

  it('the persistence layer delegates to the injected authority instance (one generation service)', async () => {
    const t = setup();
    const calls: string[] = [];
    const spy = { ...t.prep, generate: (id: string, o: Parameters<typeof t.prep.generate>[1], s?: AbortSignal) => (calls.push(`${o.mode}:${JSON.stringify(o.overrides)}`), t.prep.generate(id, o, s)) };
    const data = createPersistenceServices(t.store, { mailProvider: createFixtureMailProvider(), outreachPrep: spy });
    const c = t.add('Injected Clinic');
    await data.mail.generate({ companyId: c.id, service: 'crm', language: 'en', contactId: null, preserve: null });
    expect(calls).toEqual(['full:{"service":"crm","language":"en"}']);
  });

  it('the stateless Phase 5 endpoint /api/mail/generate is retired (410); status still works', async () => {
    const t = setup();
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, mailProvider: createFixtureMailProvider(), data: t.data, outreachPrep: t.prep, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/mail/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(410);
    expect(await (await fetch(`${base}/api/mail/status`)).json()).toEqual({ ready: true, provider: 'fixture' });
  });
});

describe('HTTP', () => {
  async function serve(t: ReturnType<typeof setup>) {
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, data: t.data, outreachPrep: t.prep, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  it('overview, detail, patch, generate, 403 cross-site, 400 invalid, 409 not ready', async () => {
    const t = setup();
    const call = await serve(t);
    const ready = t.add('Http Clinic');
    const manual = t.add('Http Manual', { research: false });
    const list = (await (await call('GET', '/api/outreach-prep')).json()) as { items: { companyId: string; readiness: { state: string } }[] };
    expect(Object.fromEntries(list.items.map((i) => [i.companyId, i.readiness.state]))).toEqual({ [ready.id]: 'ready', [manual.id]: 'missing' });
    expect((await call('POST', `/api/outreach-prep/${ready.id}/generate`, { mode: 'full' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', `/api/outreach-prep/${ready.id}/generate`, { mode: 'everything' })).status).toBe(400);
    const notReady = await call('POST', `/api/outreach-prep/${manual.id}/generate`, { mode: 'full' });
    expect(notReady.status).toBe(409);
    expect(((await notReady.json()) as { error: { reasons: { code: string }[] } }).error.reasons[0].code).toBe('no_angle');
    expect((await call('PUT', `/api/outreach-prep/${manual.id}`, { patch: { angleKey: GENERAL_INTRO } })).status).toBe(200);
    const gen = await call('POST', `/api/outreach-prep/${manual.id}/generate`, { mode: 'full' });
    expect(gen.status).toBe(200);
    expect(((await gen.json()) as { draft: { status: string } }).draft.status).toBe('review');
    expect((await call('POST', '/api/outreach-prep/batch', { companyIds: ['a1x', 'a2x', 'a3x', 'a4x', 'a5x', 'a6x'] })).status).toBe(400);
    expect((await call('GET', '/api/outreach-prep/cmp_missing')).status).toBe(404);
  });
});

describe('prompt v2', () => {
  it('structured fields only: closed claim sources, no raw research JSON; repair block lists the exact problems', async () => {
    const { buildPrepContext } = await import('../../src/domain/mail/prepContext');
    const { prepSystemPrompt, prepUserPrompt, PREP_OUTPUT_SCHEMA } = await import('../mail/prepPrompts');
    const t = setup();
    const c = t.add('Prompt Clinic');
    const r = t.prep.detail(c.id).readiness;
    const ctx = buildPrepContext({ company: c, contact: r.contact, service: 'crm', language: 'tr', tone: 'premium', angle: r.angle, general: false, angles: r.angles, cta: r.cta, manualFacts: [], mode: 'full', current: null, withVariants: false });
    const user = prepUserPrompt({ ...ctx, repairProblems: ['Kaynak gösterilmeyen iddia: "x"'] });
    expect(user).toContain('<claim_sources>');
    expect(user).toMatch(/O1 \[observed, Gözlenen\] Sitenize baktığımda/);
    expect(user).toContain('<previous_attempt_rejected>');
    expect(user).toContain('Kaynak gösterilmeyen iddia: "x"');
    expect(user).not.toMatch(/serviceOpportunities|"evidence"|exclusionChecks|opportunityScore/);
    expect(prepSystemPrompt(ctx)).toMatch(/Never invent facts/);
    expect(PREP_OUTPUT_SCHEMA.required).toEqual(['subjectOptions', 'recommendedSubject', 'sections', 'claims', 'serviceReasoning', 'variants']);
  });
});

describe('E-posta ekle (manual email on a company without one)', () => {
  async function serve(t: ReturnType<typeof setup>) {
    const server = http.createServer(createApp({ config: { ...loadConfig({}), testControls: false }, provider: null, data: t.data, outreachPrep: t.prep, fetchPage: fixtureFetcher }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return (method: string, p: string, body?: unknown) => fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const SIDE_EFFECT_TABLES = ['mail_drafts', 'mail_draft_versions', 'outbound_messages', 'follow_up_sequences', 'follow_up_steps', 'outreach_preparations', 'tasks', 'meetings', 'proposals'];

  it('generic address without a name: real contact, readiness leaves Eksik Bilgi, recipient selectable, no draft/send/follow up', async () => {
    const t = setup();
    const call = await serve(t);
    const c = t.add('Akm Clinic', { email: null });
    expect(t.prep.detail(c.id).readiness).toMatchObject({ state: 'missing', contacts: [] });
    expect(t.prep.detail(c.id).readiness.reasons.map((r) => r.code)).toContain('no_contact');
    const before = fingerprint(t.store.db, SIDE_EFFECT_TABLES);

    const plan = planManualEmail(c, { email: 'info@akmclinic.com', fullName: '', role: '' });
    expect(plan.kind).toBe('add');
    const res = await call('POST', `/api/prospects/${c.id}/contacts`, { contact: plan.kind === 'add' ? plan.contact : null });
    expect(res.status).toBe(201);
    const saved = ((await res.json()) as { company: Company }).company;
    expect(saved.contacts).toEqual([expect.objectContaining({ fullName: 'Genel iletişim', role: 'Şirketin genel iletişim bilgisi', email: 'info@akmclinic.com', confidence: 'high' })]);
    expect(saved.history[0]).toMatchObject({ type: 'contact_added', description: 'İletişim kişisi eklendi (manuel): Genel iletişim' });

    const r = t.prep.detail(c.id).readiness;
    expect(r.reasons.map((x) => x.code)).not.toContain('no_contact');
    expect(r.state).toBe('ready');
    expect(r.contacts.map((x) => x.contact.email)).toEqual(['info@akmclinic.com']);
    expect(r.contact?.contact.id).toBe(saved.contacts[0].id);
    expect(fingerprint(t.store.db, SIDE_EFFECT_TABLES)).toEqual(before);
    expect(t.store.companies.get(c.id)!).toMatchObject({ status: c.status, nextAction: c.nextAction });
  });

  it('named contact + email is added as a normal contact and offered as the recipient', async () => {
    const t = setup();
    const call = await serve(t);
    const c = t.add('Named Clinic', { email: null });
    const plan = planManualEmail(c, { email: 'ece@named.example', fullName: 'Ece Aydın', role: 'Klinik Müdürü' });
    await call('POST', `/api/prospects/${c.id}/contacts`, { contact: plan.kind === 'add' ? plan.contact : null });
    const r = t.prep.detail(c.id).readiness;
    expect(r.contacts).toEqual([expect.objectContaining({ contact: expect.objectContaining({ fullName: 'Ece Aydın', role: 'Klinik Müdürü', email: 'ece@named.example', confidence: 'medium' }) })]);
    expect(r.reasons.map((x) => x.code)).not.toContain('no_contact');
  });

  it('the same address twice on one company is stored once (server guard, any case)', async () => {
    const t = setup();
    const call = await serve(t);
    const c = t.add('Dup Clinic', { email: 'info@dup.example' });
    const first = t.store.companies.get(c.id)!;
    const res = await call('POST', `/api/prospects/${c.id}/contacts`, { contact: { fullName: 'Genel iletişim', role: '', email: ' INFO@dup.example ', phone: null, linkedin: null, isDecisionMaker: false, confidence: 'high' } });
    expect(res.status).toBe(201);
    const after = t.store.companies.get(c.id)!;
    expect(after.contacts).toHaveLength(1);
    expect(after).toEqual(first);
  });

  it('invalid and credential-like input is refused and nothing is saved', async () => {
    const t = setup();
    const call = await serve(t);
    const c = t.add('Bad Clinic', { email: null });
    const base = { fullName: 'Genel iletişim', role: '', phone: null, linkedin: null, isDecisionMaker: false, confidence: 'high' };
    expect((await call('POST', `/api/prospects/${c.id}/contacts`, { contact: { ...base, email: 'info@' } })).status).toBe(400);
    expect((await call('POST', `/api/prospects/${c.id}/contacts`, { contact: { ...base, email: 'info@bad.example', role: 'password: hunter2' } })).status).toBe(400);
    expect(t.store.companies.get(c.id)!.contacts).toEqual([]);
  });

  it('the same address on another CRM company is still added there and the duplicate checks see it', async () => {
    const t = setup();
    const call = await serve(t);
    const a = t.add('Shared One', { email: 'info@shared.example', over: { website: 'shared-one.example' } });
    const b = t.add('Other Two', { email: null, over: { website: 'other-two.example', city: 'Ankara' } });
    const res = await call('POST', `/api/prospects/${b.id}/contacts`, { contact: { fullName: 'Genel iletişim', role: '', email: 'info@shared.example', phone: null, linkedin: null, isDecisionMaker: false, confidence: 'high' } });
    expect(res.status).toBe(201);
    expect(t.store.companies.get(b.id)!.contacts.map((x) => x.email)).toEqual(['info@shared.example']);
    expect(t.store.companies.get(a.id)!.contacts).toHaveLength(1);
    expect(t.prep.detail(b.id).readiness.duplicates.map((d) => d.companyName)).toContain('Shared One');
  });
});
