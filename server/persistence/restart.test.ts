// Phase 5.5 acceptance test: data survives a real server restart. Starts the actual server process
// (server/index.ts) against a temporary database, writes data through the API, stops the process,
// starts a NEW process on the same file and reads everything back. Fixture providers only.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Company } from '../../src/domain/company';
import type { MailDraft } from '../../src/domain/mail/draft';
import type { ResearchRequest, ResearchResult } from '../../src/domain/research';
import { sampleJob, sampleResult } from '../db/testFixtures';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(path.join(tmpdir(), 'kite-restart-'));
const dbPath = path.join(dir, 'kite.db');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function startServer(port: number): Promise<{ proc: ChildProcess; log: () => string }> {
  // A clean environment: no API keys, fixture providers, the temporary database.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), HOST: '127.0.0.1', RESEARCH_PROVIDER: 'fixture', KITE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' };
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout!.on('data', (d) => (out += d));
  proc.stderr!.on('data', (d) => (out += d));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 30_000);
    proc.stdout!.on('data', () => {
      if (out.includes('[server]')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on('exit', (code) => reject(new Error(`server exited (${code}):\n${out}`)));
  });
  return { proc, log: () => out };
}

function stopServer(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    proc.removeAllListeners('exit');
    proc.on('exit', () => resolve());
    proc.kill('SIGTERM');
  });
}

describe('server restart (separate processes, same database file)', () => {
  it('keeps prospects, research, provenance and mail drafts', async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const call = async <T,>(method: string, p: string, body?: unknown) => {
      const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(res.ok, `${method} ${p} → ${res.status}`).toBe(true);
      return (await res.json()) as T;
    };

    // ---------- first process: write ----------
    const first = await startServer(port);
    const manual = (
      await call<{ company: Company }>('POST', '/api/prospects', {
        name: 'Restart Test Klinik', website: 'restart-test.example', sector: 'Diş Kliniği', city: 'İzmir', country: 'Türkiye',
        source: 'manual', opportunities: [], opportunityScore: 70, status: 'found', owner: 'Berk Çetinkaya', note: 'Kalıcı not',
      })
    ).company;
    await call('POST', `/api/prospects/${manual.id}/contacts`, { contact: { fullName: 'Deniz Kaya', role: 'Müdür', email: null, phone: null, linkedin: null, isDecisionMaker: true, confidence: 'medium' } });
    await call('POST', `/api/prospects/${manual.id}/status`, { status: 'researched' });

    const job = sampleJob();
    await call('PUT', `/api/research/jobs/${job.id}`, { job });
    await call('PUT', `/api/research/jobs/${job.id}/results`, {
      results: [
        sampleResult({
          selected: true,
          serviceOpportunities: [{ service: 'crm', score: 90, confidence: 'high', recommendation: 'primary', reason: 'r', evidenceIds: ['w1'], signals: [{ key: 'multiple_locations', label: 'Birden fazla şube', state: 'positive', reason: 'r', evidenceIds: ['w1'], origin: 'analysis', weight: 2 }] }],
        }),
      ],
    });
    const transfer = await call<{ companies: Company[] }>('POST', `/api/research/jobs/${job.id}/transfer`, {});
    const transferred = transfer.companies[0];

    const running = sampleJob({ id: 'rsch_running', status: 'running', completedAt: null });
    await call('PUT', `/api/research/jobs/${running.id}`, { job: running });

    const draft = (await call<{ draft: MailDraft }>('POST', '/api/mail/drafts/generate', { companyId: transferred.id, service: 'crm', language: 'en', contactId: null, preserve: null })).draft;
    const edited = `${draft.body}\n\nManual edit before restart.`;
    await call('POST', `/api/mail/drafts/${draft.id}/save`, { edits: { selectedSubject: draft.subjectOptions[2], body: edited } });
    await call('POST', '/api/mail/drafts/generate', { companyId: transferred.id, service: 'crm', language: 'en', contactId: null, preserve: { selectedSubject: draft.subjectOptions[2], body: edited } });
    const latest = (await call<{ drafts: MailDraft[] }>('GET', '/api/mail/drafts')).drafts[0];
    const approved = (await call<{ draft: MailDraft }>('POST', `/api/mail/drafts/${draft.id}/approve`, { edits: { selectedSubject: latest.selectedSubject, body: latest.body } })).draft;

    const before = {
      companies: (await call<{ companies: Company[] }>('GET', '/api/prospects')).companies,
      research: await call<{ jobs: ResearchRequest[]; resultsByJob: Record<string, ResearchResult[]> }>('GET', '/api/research/jobs'),
      drafts: (await call<{ drafts: MailDraft[] }>('GET', '/api/mail/drafts')).drafts,
    };
    await stopServer(first.proc);

    // ---------- second process: read ----------
    const second = await startServer(port);
    expect(second.log()).toContain('1 yarıda kalan araştırma işaretlendi');
    const companies = (await call<{ companies: Company[] }>('GET', '/api/prospects')).companies;
    const research = await call<{ jobs: ResearchRequest[]; resultsByJob: Record<string, ResearchResult[]> }>('GET', '/api/research/jobs');
    const drafts = (await call<{ drafts: MailDraft[] }>('GET', '/api/mail/drafts')).drafts;
    await stopServer(second.proc);

    // Companies: identical records, including contacts, notes, history and status.
    expect(companies).toEqual(before.companies);
    const m = companies.find((c) => c.id === manual.id)!;
    expect(m).toMatchObject({ status: 'researched', sector: 'Diş Kliniği', sectorId: 'dental_clinic' });
    expect(m.contacts.map((c) => c.fullName)).toEqual(['Deniz Kaya']);
    expect(m.notes.map((n) => n.content)).toEqual(['Kalıcı not']);
    // Research provenance of the transferred company.
    const t = companies.find((c) => c.id === transferred.id)!;
    expect(t.researchRef).toMatchObject({ requestId: job.id, mode: 'real' });
    expect(t.researchRef?.sources?.map((s) => s.sourceType)).toEqual(['official_website', 'directory']);
    // Research history and results (with the evidence snapshot); the running job was interrupted.
    expect(research.resultsByJob).toEqual(before.research.resultsByJob);
    expect(research.resultsByJob[job.id][0]).toMatchObject({ transferredCompanyId: transferred.id, verification: { status: 'verified' } });
    expect(research.jobs.find((j) => j.id === job.id)).toEqual(before.research.jobs.find((j) => j.id === job.id));
    expect(research.jobs.find((j) => j.id === running.id)).toMatchObject({ status: 'failed', errorMessage: 'Araştırma, sunucu yeniden başlatıldığı için yarıda kaldı.' });
    // Mail draft: approval, previous version and provenance survive.
    expect(drafts).toEqual(before.drafts);
    expect(drafts[0]).toMatchObject({ id: draft.id, status: 'approved', approvedAt: approved.approvedAt });
    expect(drafts[0].previousVersions[0]).toMatchObject({ subject: draft.subjectOptions[2], body: edited, reason: 'before_regeneration' });
    expect(drafts[0].evidenceRefs).toEqual([expect.objectContaining({ id: 'w1', inspected: true })]);
    expect(drafts[0].generationNotes.personalization).toBe('specific');
  }, 90_000);
});
