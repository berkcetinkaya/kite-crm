// Phase 8.1: schema v4 (meetings, proposals, proposal items), repositories and the v3 → v4 upgrade.
// The upgrade test builds a realistic Phase 7 database through the real Phase 6/7 code paths
// (fixture Gmail send, follow-up plan, reply sync) and checks that nothing is lost or changed.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BILLING_TYPES, CURRENCIES, MEETING_STATUSES, MEETING_TYPES, PROPOSAL_STATUSES, TAX_MODES, type Meeting, type Proposal } from '../../src/domain/sales';
import type { NewCompanyInput } from '../../src/state/companies/companyCommands';
import { createClock } from '../clock';
import { MIGRATIONS, runMigrations } from '../db/migrations';
import { openDatabase, type Db } from '../db/sqlite';
import { createStore, openStore, type OpenedStore } from '../db/store';
import { createFollowUpPlanner } from '../followUp/service';
import { createGmailAdapter } from '../gmail/adapter';
import { createMemoryCredentialStore } from '../gmail/credentialStore';
import { createFixtureGmail, FIXTURE_AUTH_CODE } from '../gmail/fixture';
import { createFixtureMailProvider } from '../mail/fixtureMailProvider';
import { createOutreachService } from '../outreach/service';
import { createPersistenceServices } from '../persistence/services';

const dirs: string[] = [];
const dbs: Db[] = [];
const stores: OpenedStore[] = [];
afterEach(() => {
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

const tmpFile = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kite-p8-'));
  dirs.push(d);
  return path.join(d, 'kite.db');
};

const company = (name: string, email: string): NewCompanyInput => ({
  name,
  website: null,
  sector: 'Diş Kliniği',
  city: 'İzmir',
  country: 'Türkiye',
  source: 'manual',
  opportunities: [{ service: 'crm', score: 80, potential: 'high', reason: '' }],
  opportunityScore: 80,
  status: 'researched',
  owner: 'Berk Çetinkaya',
  note: '',
  contacts: [{ fullName: 'Ece Aydın', role: 'Müdür', email, phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' }],
});

const TABLES = ['companies', 'company_contacts', 'company_history', 'company_notes', 'company_opportunities', 'mail_drafts', 'mail_draft_versions', 'outbound_messages', 'mail_messages', 'mail_sync_runs', 'follow_up_sequences', 'follow_up_steps', 'app_settings', 'research_jobs', 'research_results'];
const counts = (db: Db) => Object.fromEntries(TABLES.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
/** Full content of the Phase 7 tables, to prove the upgrade changes no row. */
const snapshot = (db: Db) => Object.fromEntries(TABLES.map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())]));

/** A Phase 7 (v3) database with a replied conversation and an active follow-up plan. */
async function phase7Database(file: string) {
  const db = openDatabase(file);
  dbs.push(db);
  runMigrations(db, MIGRATIONS.filter((m) => m.version <= 3));
  const store = createStore(db);
  const clock = createClock(0, () => Date.parse('2026-10-06T09:00:00.000Z'));
  const now = () => clock.now();
  const fx = createFixtureGmail({ redirectUri: '/cb', now: () => clock.now().getTime() });
  const gmail = createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials: createMemoryCredentialStore() });
  const { state } = gmail.beginAuthorization();
  await gmail.completeAuthorization({ code: FIXTURE_AUTH_CODE, state });
  const planner = createFollowUpPlanner(store, { now, mailProvider: createFixtureMailProvider() });
  const data = createPersistenceServices(store, { now, mailProvider: createFixtureMailProvider(), followUps: planner });
  const outreach = createOutreachService(store, gmail, { now, followUps: planner });
  for (const [name, email] of [['Replied Clinic', 'ece@replied.example'], ['Waiting Clinic', 'ece@waiting.example']] as const) {
    const c = data.companies.create(company(name, email));
    const d = await data.mail.generate({ companyId: c.id, service: 'crm', language: 'tr', contactId: null, preserve: null });
    data.mail.approve(d.id, { selectedSubject: d.selectedSubject, body: d.body });
    await outreach.send({ draftId: d.id, companyId: c.id, contactId: c.contacts[0].id, idempotencyKey: `idem_p8_${name.replace(/\W/g, '')}_000001` });
  }
  const replied = store.outreach.listThreadSends().find((s) => s.recipientEmail === 'ece@replied.example')!;
  fx.controls.addReply(replied.gmailThreadId!, { shape: 'mixed' });
  await outreach.sync();
  return db;
}

describe('schema v4', () => {
  it('a fresh installation goes straight to the latest schema with the three sales tables', () => {
    const s = openStore(':memory:');
    stores.push(s);
    expect(s.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    for (const t of ['meetings', 'proposals', 'proposal_items']) expect(s.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)).toEqual({ n: 1 });
  });

  it('literal enumerations in v4 match the sales domain', () => {
    const list = (v: readonly string[]) => v.map((x) => `'${x}'`).join(',');
    const sql = MIGRATIONS.find((m) => m.version === 4)!.sql;
    for (const values of [MEETING_TYPES, MEETING_STATUSES, PROPOSAL_STATUSES, CURRENCIES, TAX_MODES, BILLING_TYPES]) expect(sql).toContain(list(values));
    expect(MIGRATIONS.find((m) => m.version === 4)!.foreignKeysOff).toBeUndefined();
  });

  it('upgrades a Phase 7 database (sends, replies, Gmail ids, follow-up plans, history) without changing any row', async () => {
    const file = tmpFile();
    const db = await phase7Database(file);
    const before = counts(db);
    const content = snapshot(db);
    expect(before).toMatchObject({ companies: 2, outbound_messages: 2, follow_up_sequences: 2 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM mail_messages WHERE direction = 'inbound'").get() as { n: number }).n).toBe(1);
    expect(db.prepare('SELECT status FROM follow_up_sequences ORDER BY created_at').all().map((r) => (r as { status: string }).status).sort()).toEqual(['active', 'completed_replied']);
    db.close();

    const s = openStore(file);
    stores.push(s);
    // Upgraded from v3 through v4 (sales) to the latest schema.
    expect(s.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    expect(counts(s.db)).toEqual(before);
    expect(snapshot(s.db)).toEqual(content);
    expect(s.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(s.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(s.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(s.sales.listMeetings()).toEqual([]);
    expect(s.sales.listProposals()).toEqual([]);
    // Running migrations again is a no-op.
    expect(runMigrations(s.db)).toEqual({ applied: [], version: MIGRATIONS.at(-1)!.version });
  });
});

describe('sales repository', () => {
  const at = '2026-10-06T10:00:00.000Z';
  function withCompany() {
    const s = openStore(':memory:');
    stores.push(s);
    const data = createPersistenceServices(s);
    const c = data.companies.create(company('Repo Clinic', 'ece@repo.example'));
    return { s, c };
  }
  const meeting = (companyId: string, over: Partial<Meeting> = {}): Meeting => ({
    id: 'mtg_test_1',
    companyId,
    scheduledAt: at,
    type: 'online',
    status: 'planned',
    contactId: null,
    contactName: null,
    contactEmail: null,
    notes: '',
    outcome: '',
    nextActionLabel: null,
    nextActionDueAt: null,
    completedAt: null,
    createdAt: at,
    updatedAt: at,
    ...over,
  });
  const proposal = (companyId: string, over: Partial<Proposal> = {}): Proposal => ({
    id: 'prp_test_1',
    companyId,
    title: 'CRM ve reklam paketi',
    currency: 'TRY',
    contractMonths: 12,
    validUntil: null,
    notes: '',
    taxMode: 'excluded',
    taxRateBp: 2000,
    status: 'draft',
    sentAt: null,
    decidedAt: null,
    lossReason: null,
    createdAt: at,
    updatedAt: at,
    items: [
      { id: 'pit_1', proposalId: 'prp_test_1', position: 0, service: 'website', description: 'Website yenileme', billingType: 'one_time', unitAmountMinor: 4_500_000, quantity: 1, createdAt: at, updatedAt: at },
      { id: 'pit_2', proposalId: 'prp_test_1', position: 1, service: 'meta_ads', description: 'Reklam yönetimi', billingType: 'monthly', unitAmountMinor: 1_250_000, quantity: 1, createdAt: at, updatedAt: at },
    ],
    ...over,
  });

  it('round-trips meetings and proposals with items in order; items are replaced as a set', () => {
    const { s, c } = withCompany();
    s.sales.saveMeeting(meeting(c.id));
    expect(s.sales.getMeeting('mtg_test_1')).toEqual(meeting(c.id));
    s.sales.saveProposal(proposal(c.id));
    expect(s.sales.getProposal('prp_test_1')).toEqual(proposal(c.id));
    const fewer = proposal(c.id, { items: [proposal(c.id).items[1]] });
    s.sales.saveProposal(fewer);
    expect(s.sales.getProposal('prp_test_1')!.items.map((i) => [i.id, i.position])).toEqual([['pit_2', 0]]);
    expect(s.sales.listProposals()).toHaveLength(1);
  });

  it('the database refuses inconsistent states', () => {
    const { s, c } = withCompany();
    expect(() => s.sales.saveMeeting(meeting(c.id, { status: 'completed', completedAt: null }))).toThrow(/CHECK/);
    expect(() => s.sales.saveProposal(proposal(c.id, { status: 'sent', sentAt: null }))).toThrow(/CHECK/);
    expect(() => s.sales.saveProposal(proposal(c.id, { status: 'accepted', sentAt: at, decidedAt: null }))).toThrow(/CHECK/);
    expect(() => s.sales.saveProposal(proposal(c.id, { items: [{ ...proposal(c.id).items[0], unitAmountMinor: -1 }] }))).toThrow(/CHECK/);
    expect(() => s.sales.saveProposal(proposal(c.id, { companyId: 'cmp_missing' }))).toThrow(/FOREIGN KEY/);
    // A failed save leaves nothing behind (proposal and items are one transaction).
    expect(s.sales.listProposals()).toEqual([]);
  });
});
