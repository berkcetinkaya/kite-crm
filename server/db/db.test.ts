// Database layer tests. Every test uses its own temporary database; nothing touches data/.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Company } from '../../src/domain/company';
import type { MailDraft } from '../../src/domain/mail/draft';
import { COMPANY_SOURCE_ORDER, COMPANY_SIZE_ORDER } from '../../src/domain/company';
import { MAIL_DRAFT_STATUSES } from '../../src/domain/mail/draft';
import { RESEARCH_STATUS_ORDER } from '../../src/domain/research';
import { SALES_STATUS_ORDER } from '../../src/domain/salesStatus';
import { SERVICE_KEYS } from '../../src/domain/services';
import { MIGRATIONS, runMigrations } from './migrations';
import { openDatabase } from './sqlite';
import { openStore, type OpenedStore } from './store';
import { sampleCompany, sampleJob, sampleResult } from './testFixtures';

const dirs: string[] = [];
const stores: OpenedStore[] = [];
function tempFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kite-db-'));
  dirs.push(dir);
  return path.join(dir, 'kite.db');
}
function store(file = tempFile()) {
  const s = openStore(file);
  stores.push(s);
  return s;
}
afterEach(() => {
  for (const s of stores.splice(0)) {
    try {
      s.close();
    } catch {
      // already closed
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('migrations', () => {
  it('initializes an empty database with the current schema', () => {
    const s = store();
    expect(s.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    const tables = (s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(
      expect.arrayContaining(['companies', 'company_contacts', 'company_notes', 'company_history', 'company_opportunities', 'research_jobs', 'research_results', 'mail_drafts', 'mail_draft_versions', 'schema_migrations']),
    );
    expect(s.companies.list()).toEqual([]);
    expect(s.research.listJobs()).toEqual([]);
    expect(s.mail.list()).toEqual([]);
  });

  it('is idempotent: running again applies nothing and keeps data', () => {
    const file = tempFile();
    const s = store(file);
    s.companies.insert(sampleCompany());
    expect(runMigrations(s.db)).toEqual({ applied: [], version: 1 });
    s.close();
    const again = store(file);
    expect(again.companies.list()).toHaveLength(1);
    expect((again.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(1);
  });

  it('enables foreign keys and WAL', () => {
    const s = store();
    expect(s.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(s.db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  });

  it('a failing migration rolls back completely', () => {
    const db = openDatabase(':memory:');
    expect(() => runMigrations(db, [{ version: 1, name: 'broken', sql: 'CREATE TABLE ok (x); CREATE TABLE ok (x);' }])).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ok'").get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 0 });
  });

  it('literal enumerations in the schema still match the domain (new values need a migration)', () => {
    const sql = MIGRATIONS[0].sql;
    const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');
    expect(sql).toContain(list(SALES_STATUS_ORDER));
    expect(sql).toContain(list(COMPANY_SOURCE_ORDER));
    expect(sql).toContain(list(COMPANY_SIZE_ORDER));
    expect(sql).toContain(list(SERVICE_KEYS));
    expect(sql).toContain(list(RESEARCH_STATUS_ORDER));
    expect(sql).toContain(list(MAIL_DRAFT_STATUSES));
  });
});

describe('company repository', () => {
  it('round-trips the complete company aggregate', () => {
    const s = store();
    const c = sampleCompany({ nextAction: { label: 'Ara', dueAt: '2026-10-06T09:00:00.000Z' }, lastContactAt: '2026-10-04T09:00:00.000Z', companySize: '11-50' });
    s.companies.insert(c);
    expect(s.companies.get(c.id)).toEqual(c);
    expect(s.companies.list()).toEqual([c]);
  });

  it('save replaces child rows (contacts, notes, history, opportunities)', () => {
    const s = store();
    const c = sampleCompany();
    s.companies.insert(c);
    const next: Company = {
      ...c,
      status: 'researched',
      contacts: [...c.contacts, { id: 'ct_new', fullName: 'Lena Hart', role: 'Director', email: 'l@x.example', phone: null, linkedin: null, isDecisionMaker: true, confidence: 'high' }],
      notes: [{ id: 'note_new', content: 'Not', author: 'Berk Çetinkaya', createdAt: '2026-10-05T11:00:00.000Z' }, ...c.notes],
      opportunities: [{ service: 'crm', score: 77, potential: 'high', reason: 'x' }],
    };
    s.companies.save(next);
    expect(s.companies.get(c.id)).toEqual(next);
  });

  it('rejects invalid values through constraints', () => {
    const s = store();
    expect(() => s.companies.insert(sampleCompany({ status: 'sent' as never }))).toThrow();
    expect(() => s.companies.insert(sampleCompany({ id: 'cmp_x', opportunityScore: 140 }))).toThrow();
    expect(s.companies.list()).toEqual([]);
  });

  it('a failing child insert leaves no partial company', () => {
    const s = store();
    const bad = sampleCompany({ opportunities: [{ service: 'cold_calls' as never, score: 1, potential: null, reason: '' }] });
    expect(() => s.companies.insert(bad)).toThrow();
    expect(s.companies.get(bad.id)).toBeNull();
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM company_contacts').get() as { n: number }).n).toBe(0);
  });

  it('duplicate detection works against persisted companies (website first, then name + canonical country)', () => {
    const s = store();
    s.companies.insert(sampleCompany({ id: 'c1', name: 'Aurora Dental Studio', website: 'aurora-dental.example', country: 'United Arab Emirates' }));
    s.companies.insert(sampleCompany({ id: 'c2', name: 'Harley Smiles', website: null, country: 'United Kingdom', contacts: [], notes: [], history: [] }));
    expect(s.companies.findDuplicate({ name: 'Other', website: 'https://www.aurora-dental.example/book', country: 'AE' })?.id).toBe('c1');
    expect(s.companies.findDuplicate({ name: 'harley smiles', website: null, country: 'UK' })?.id).toBe('c2');
    expect(s.companies.findDuplicate({ name: 'Harley Smiles', website: null, country: 'GB' })?.id).toBe('c2');
    expect(s.companies.findDuplicate({ name: 'Harley Smiles', website: null, country: 'AE' })).toBeNull();
    expect(s.companies.findDuplicate({ name: 'New Clinic', website: 'new.example', country: 'AE' })).toBeNull();
  });
});

describe('research repository', () => {
  it('round-trips jobs and results with the full evidence snapshot', () => {
    const s = store();
    s.research.saveJob(sampleJob());
    s.research.saveResults('rsch_1', [sampleResult()]);
    expect(s.research.getJob('rsch_1')).toEqual(sampleJob());
    expect(s.research.listResults('rsch_1')).toEqual([sampleResult()]);
    expect(s.research.listResultsByJob()).toEqual({ rsch_1: [sampleResult()] });
  });

  it('upserts results by id and keeps their order', () => {
    const s = store();
    s.research.saveJob(sampleJob());
    s.research.saveResults('rsch_1', [sampleResult(), sampleResult({ id: 'res_2', companyName: 'B' })]);
    s.research.saveResults('rsch_1', [sampleResult({ selected: true, analysisError: null })]);
    expect(s.research.listResults('rsch_1').map((r) => [r.id, r.selected])).toEqual([['res_1', true], ['res_2', false]]);
  });

  it('results require an existing job, and transferred companies are linked', () => {
    const s = store();
    expect(() => s.research.saveResults('missing', [sampleResult()])).toThrow();
    s.research.saveJob(sampleJob());
    s.companies.insert(sampleCompany({ id: 'cmp_t' }));
    s.research.saveResults('rsch_1', [sampleResult({ transferredCompanyId: 'cmp_t', alreadyInProspects: true })]);
    expect(s.research.findTransferredResult('cmp_t')?.id).toBe('res_1');
    expect(() => s.research.saveResults('rsch_1', [sampleResult({ id: 'res_x', transferredCompanyId: 'cmp_nope' })])).toThrow();
  });

  it('marks jobs left running as interrupted', () => {
    const s = store();
    s.research.saveJob(sampleJob({ status: 'running', completedAt: null }));
    expect(s.research.markInterrupted('yarıda kaldı', '2026-10-05T12:00:00.000Z')).toBe(1);
    expect(s.research.getJob('rsch_1')).toMatchObject({ status: 'failed', errorMessage: 'yarıda kaldı', completedAt: '2026-10-05T12:00:00.000Z' });
  });
});

describe('mail draft repository', () => {
  const draft = (over: Partial<MailDraft> = {}): MailDraft => ({
    id: 'mail_1',
    companyId: 'cmp_1',
    contactId: null,
    service: 'crm',
    language: 'en',
    subjectOptions: ['A', 'B', 'C'],
    selectedSubject: 'B',
    body: 'Hello',
    status: 'draft',
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:05:00.000Z',
    generatedAt: '2026-10-05T10:00:00.000Z',
    approvedAt: null,
    researchJobId: 'rsch_1',
    evidenceRefs: [{ kind: 'company_evidence', id: 'w1', url: 'https://a.example/', title: 't', sourceType: 'official_website', claim: 'c', inspected: true }],
    sectorContext: { kind: 'sector_guidance', sectorLabel: 'Diş Kliniği', sectorId: 'dental_clinic', familyLabel: 'Sağlık', familyId: 'health', source: 'sector', profileId: 'dental_clinic', summaryTr: 's', useCasesUsed: [{ id: 'recall', tr: 'r' }], useCasesAvailable: [] },
    generationNotes: { provider: 'fixture', model: null, personalization: 'specific', personalizationReasons: ['r'], companyObservation: 'o', serviceReasoning: 's', warnings: [], promptVersion: 'mail-v1' },
    editedSinceGeneration: true,
    previousVersions: [{ subject: 'Old', body: 'Old body', savedAt: '2026-10-05T10:03:00.000Z', reason: 'before_regeneration' }],
    ...over,
  });

  it('round-trips a draft with previous versions and provenance', () => {
    const s = store();
    s.companies.insert(sampleCompany({ id: 'cmp_1' }));
    s.mail.save(draft());
    expect(s.mail.get('mail_1')).toEqual(draft());
    expect(s.mail.getByCompany('cmp_1')).toEqual(draft());
    s.mail.save(draft({ status: 'approved', approvedAt: '2026-10-05T11:00:00.000Z', previousVersions: [] }));
    expect(s.mail.list()).toEqual([draft({ status: 'approved', approvedAt: '2026-10-05T11:00:00.000Z', previousVersions: [] })]);
  });

  it('enforces one draft per company and an existing company', () => {
    const s = store();
    s.companies.insert(sampleCompany({ id: 'cmp_1' }));
    s.mail.save(draft());
    expect(() => s.mail.save(draft({ id: 'mail_2' }))).toThrow();
    expect(() => s.mail.save(draft({ id: 'mail_3', companyId: 'cmp_missing' }))).toThrow();
    expect(() => s.mail.save(draft({ id: 'mail_4', companyId: 'cmp_1', status: 'sent' as never }))).toThrow();
  });
});

describe('data survives reopening the file', () => {
  it('companies, research and drafts are still there after close and reopen', () => {
    const file = tempFile();
    const a = store(file);
    a.companies.insert(sampleCompany({ id: 'cmp_1' }));
    a.research.saveJob(sampleJob());
    a.research.saveResults('rsch_1', [sampleResult()]);
    a.close();
    const b = store(file);
    expect(b.companies.get('cmp_1')?.name).toBeTruthy();
    expect(b.research.listResults('rsch_1')[0].evidence?.map((e) => e.sourceType)).toEqual(['official_website', 'directory']);
  });
});
