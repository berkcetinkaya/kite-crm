// SQLite repository for outreach preparations (Phase 13).
import type { OutreachPreparation } from '../../../src/domain/outreachPrep';
import type { Db } from '../sqlite';
import type { OutreachPrepRepository } from './types';

type Row = Record<string, unknown>;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const json = <T,>(v: unknown, fallback: T): T => (typeof v === 'string' ? (JSON.parse(v) as T) : fallback);

const toPrep = (r: Row): OutreachPreparation => {
  const map = json<{ sources: OutreachPreparation['claimSources']; claims: OutreachPreparation['claims'] }>(r.claim_map_json, { sources: [], claims: [] });
  return {
    companyId: r.company_id as string,
    draftId: sn(r.draft_id),
    contactId: sn(r.contact_id),
    contactSnapshot: json(r.contact_snapshot_json, null),
    service: sn(r.service) as OutreachPreparation['service'],
    angleKey: sn(r.angle_key),
    tone: r.tone as OutreachPreparation['tone'],
    ctaKey: sn(r.cta_key) as OutreachPreparation['ctaKey'],
    language: sn(r.language) as OutreachPreparation['language'],
    manualFacts: json(r.manual_facts_json, []),
    duplicateAcks: json(r.duplicate_ack_json, []),
    claimSources: map.sources ?? [],
    claims: map.claims ?? [],
    sections: json(r.sections_json, []),
    subjectOptions: json(r.subject_options_json, []),
    variants: json(r.variants_json, []),
    readinessSnapshot: json(r.readiness_snapshot_json, null),
    promptVersion: sn(r.prompt_version),
    provider: sn(r.provider) as OutreachPreparation['provider'],
    generatedAt: sn(r.generated_at),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
};

export function createOutreachPrepRepository(db: Db): OutreachPrepRepository {
  // Prepared on first use (the store may be built before migrations reach v8 in upgrade tests).
  let prepared: ReturnType<typeof prepare> | null = null;
  const prepare = () => ({
    get: db.prepare('SELECT * FROM outreach_preparations WHERE company_id = ?'),
    list: db.prepare('SELECT * FROM outreach_preparations ORDER BY updated_at DESC'),
    upsert: db.prepare(`INSERT INTO outreach_preparations (company_id, draft_id, contact_id, contact_snapshot_json, service, angle_key, tone, cta_key, language,
      manual_facts_json, duplicate_ack_json, claim_map_json, sections_json, subject_options_json, variants_json, readiness_snapshot_json, prompt_version, provider,
      generated_at, created_at, updated_at)
      VALUES (:company_id, :draft_id, :contact_id, :contact_snapshot_json, :service, :angle_key, :tone, :cta_key, :language,
      :manual_facts_json, :duplicate_ack_json, :claim_map_json, :sections_json, :subject_options_json, :variants_json, :readiness_snapshot_json, :prompt_version, :provider,
      :generated_at, :created_at, :updated_at)
      ON CONFLICT(company_id) DO UPDATE SET draft_id = excluded.draft_id, contact_id = excluded.contact_id, contact_snapshot_json = excluded.contact_snapshot_json,
      service = excluded.service, angle_key = excluded.angle_key, tone = excluded.tone, cta_key = excluded.cta_key, language = excluded.language,
      manual_facts_json = excluded.manual_facts_json, duplicate_ack_json = excluded.duplicate_ack_json, claim_map_json = excluded.claim_map_json,
      sections_json = excluded.sections_json, subject_options_json = excluded.subject_options_json, variants_json = excluded.variants_json,
      readiness_snapshot_json = excluded.readiness_snapshot_json, prompt_version = excluded.prompt_version, provider = excluded.provider,
      generated_at = excluded.generated_at, updated_at = excluded.updated_at`),
  });
  const q = () => (prepared ??= prepare());

  return {
    get(companyId) {
      const r = q().get.get(companyId) as Row | undefined;
      return r ? toPrep(r) : null;
    },
    list: () => (q().list.all() as Row[]).map(toPrep),
    save(p) {
      q().upsert.run({
        company_id: p.companyId,
        draft_id: p.draftId,
        contact_id: p.contactId,
        contact_snapshot_json: p.contactSnapshot ? JSON.stringify(p.contactSnapshot) : null,
        service: p.service,
        angle_key: p.angleKey,
        tone: p.tone,
        cta_key: p.ctaKey,
        language: p.language,
        manual_facts_json: JSON.stringify(p.manualFacts),
        duplicate_ack_json: JSON.stringify(p.duplicateAcks),
        claim_map_json: JSON.stringify({ sources: p.claimSources, claims: p.claims }),
        sections_json: JSON.stringify(p.sections),
        subject_options_json: JSON.stringify(p.subjectOptions),
        variants_json: JSON.stringify(p.variants),
        readiness_snapshot_json: p.readinessSnapshot ? JSON.stringify(p.readinessSnapshot) : null,
        prompt_version: p.promptVersion,
        provider: p.provider,
        generated_at: p.generatedAt,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      });
    },
  };
}
