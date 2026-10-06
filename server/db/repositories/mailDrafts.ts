// SQLite mail draft repository. A company has one first contact draft (partial UNIQUE index) and, from
// Phase 7, one follow up draft per follow up sequence step. Previous versions are rows of
// mail_draft_versions. Provenance written once per generation (evidenceRefs, sectorContext,
// generationNotes) and the subject options are JSON snapshots: they are produced and replaced
// together and never queried field by field.
import type { MailDraft, MailDraftVersion } from '../../../src/domain/mail/draft';
import { fromJson, transaction, type Db } from '../sqlite';
import type { MailDraftRepository } from './types';

type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));

export function createMailDraftRepository(db: Db): MailDraftRepository {
  const q = {
    firstContact: db.prepare("SELECT * FROM mail_drafts WHERE kind = 'first_contact' ORDER BY updated_at DESC"),
    followUps: db.prepare("SELECT * FROM mail_drafts WHERE kind = 'follow_up' ORDER BY updated_at DESC"),
    one: db.prepare('SELECT * FROM mail_drafts WHERE id = ?'),
    byCompany: db.prepare("SELECT * FROM mail_drafts WHERE company_id = ? AND kind = 'first_contact'"),
    byStep: db.prepare("SELECT * FROM mail_drafts WHERE kind = 'follow_up' AND follow_up_sequence_id = ? AND follow_up_step_number = ?"),
    versions: db.prepare('SELECT * FROM mail_draft_versions ORDER BY draft_id, position'),
    versionsOf: db.prepare('SELECT * FROM mail_draft_versions WHERE draft_id = ? ORDER BY position'),
    // kind and the follow up link are written once (insert) and never changed by an update.
    upsert: db.prepare(`INSERT INTO mail_drafts (id, company_id, kind, follow_up_sequence_id, follow_up_step_number, follows_outbound_id, contact_id, service,
      language, subject_options_json, selected_subject, body, status, research_job_id, evidence_refs_json, sector_context_json, generation_notes_json,
      edited_since_generation, created_at, updated_at, generated_at, approved_at)
      VALUES (:id, :company_id, :kind, :follow_up_sequence_id, :follow_up_step_number, :follows_outbound_id, :contact_id, :service,
      :language, :subject_options_json, :selected_subject, :body, :status, :research_job_id, :evidence_refs_json, :sector_context_json, :generation_notes_json,
      :edited_since_generation, :created_at, :updated_at, :generated_at, :approved_at)
      ON CONFLICT(id) DO UPDATE SET contact_id = excluded.contact_id, service = excluded.service, language = excluded.language,
      subject_options_json = excluded.subject_options_json, selected_subject = excluded.selected_subject, body = excluded.body,
      status = excluded.status, research_job_id = excluded.research_job_id, evidence_refs_json = excluded.evidence_refs_json,
      sector_context_json = excluded.sector_context_json, generation_notes_json = excluded.generation_notes_json,
      edited_since_generation = excluded.edited_since_generation, updated_at = excluded.updated_at,
      generated_at = excluded.generated_at, approved_at = excluded.approved_at`),
    delVersions: db.prepare('DELETE FROM mail_draft_versions WHERE draft_id = ?'),
    addVersion: db.prepare('INSERT INTO mail_draft_versions (draft_id, position, subject, body, saved_at, reason) VALUES (?, ?, ?, ?, ?, ?)'),
  };

  const version = (r: Row): MailDraftVersion => ({ subject: s(r.subject), body: s(r.body), savedAt: s(r.saved_at), reason: s(r.reason) as MailDraftVersion['reason'] });

  const toDraft = (r: Row, previousVersions: MailDraftVersion[]): MailDraft => ({
    id: s(r.id),
    // First contact drafts keep their Phase 5 shape (no kind / followUp fields).
    ...(r.kind === 'follow_up'
      ? {
          kind: 'follow_up' as const,
          followUp: { sequenceId: s(r.follow_up_sequence_id), stepNumber: Number(r.follow_up_step_number), followsOutboundId: s(r.follows_outbound_id) },
        }
      : {}),
    companyId: s(r.company_id),
    contactId: sn(r.contact_id),
    service: s(r.service) as MailDraft['service'],
    language: s(r.language) as MailDraft['language'],
    subjectOptions: fromJson<string[]>(r.subject_options_json) ?? [],
    selectedSubject: s(r.selected_subject),
    body: s(r.body),
    status: s(r.status) as MailDraft['status'],
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
    generatedAt: s(r.generated_at),
    approvedAt: sn(r.approved_at),
    researchJobId: sn(r.research_job_id),
    evidenceRefs: fromJson<MailDraft['evidenceRefs']>(r.evidence_refs_json) ?? [],
    sectorContext: fromJson<MailDraft['sectorContext']>(r.sector_context_json)!,
    generationNotes: fromJson<MailDraft['generationNotes']>(r.generation_notes_json)!,
    editedSinceGeneration: Number(r.edited_since_generation) === 1,
    previousVersions,
  });

  const load = (r: Row | undefined) => (r ? toDraft(r, (q.versionsOf.all(s(r.id)) as Row[]).map(version)) : null);

  const listOf = (rows: Row[]) => {
    const versions = new Map<string, MailDraftVersion[]>();
    for (const r of q.versions.all() as Row[]) (versions.get(s(r.draft_id)) ?? versions.set(s(r.draft_id), []).get(s(r.draft_id))!).push(version(r));
    return rows.map((r) => toDraft(r, versions.get(s(r.id)) ?? []));
  };

  return {
    list: () => listOf(q.firstContact.all() as Row[]),
    listFollowUps: () => listOf(q.followUps.all() as Row[]),
    get: (id) => load(q.one.get(id) as Row | undefined),
    getByCompany: (companyId) => load(q.byCompany.get(companyId) as Row | undefined),
    getByStep: (sequenceId, stepNumber) => load(q.byStep.get(sequenceId, stepNumber) as Row | undefined),
    save(d) {
      transaction(db, () => {
        q.upsert.run({
          id: d.id,
          company_id: d.companyId,
          kind: d.kind ?? 'first_contact',
          follow_up_sequence_id: d.followUp?.sequenceId ?? null,
          follow_up_step_number: d.followUp?.stepNumber ?? null,
          follows_outbound_id: d.followUp?.followsOutboundId ?? null,
          contact_id: d.contactId,
          service: d.service,
          language: d.language,
          subject_options_json: JSON.stringify(d.subjectOptions),
          selected_subject: d.selectedSubject,
          body: d.body,
          status: d.status,
          research_job_id: d.researchJobId,
          evidence_refs_json: JSON.stringify(d.evidenceRefs),
          sector_context_json: JSON.stringify(d.sectorContext),
          generation_notes_json: JSON.stringify(d.generationNotes),
          edited_since_generation: d.editedSinceGeneration ? 1 : 0,
          created_at: d.createdAt,
          updated_at: d.updatedAt,
          generated_at: d.generatedAt,
          approved_at: d.approvedAt,
        });
        q.delVersions.run(d.id);
        d.previousVersions.forEach((v, i) => q.addVersion.run(d.id, i, v.subject, v.body, v.savedAt, v.reason));
      });
    },
  };
}
