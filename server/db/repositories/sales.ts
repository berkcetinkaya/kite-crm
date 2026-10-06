// SQLite sales repository (Phase 8): meetings and proposals with their line items. A proposal and
// its items are saved together (items are replaced as a set, in position order).
import type { Meeting, Proposal, ProposalItem } from '../../../src/domain/sales';
import { transaction, type Db } from '../sqlite';
import type { SalesRepository } from './types';

type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const toMeeting = (r: Row): Meeting => ({
  id: s(r.id),
  companyId: s(r.company_id),
  scheduledAt: s(r.scheduled_at),
  type: s(r.type) as Meeting['type'],
  status: s(r.status) as Meeting['status'],
  contactId: sn(r.contact_id),
  contactName: sn(r.contact_name),
  contactEmail: sn(r.contact_email),
  notes: s(r.notes),
  outcome: s(r.outcome),
  nextActionLabel: sn(r.next_action_label),
  nextActionDueAt: sn(r.next_action_due_at),
  completedAt: sn(r.completed_at),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const toItem = (r: Row): ProposalItem => ({
  id: s(r.id),
  proposalId: s(r.proposal_id),
  position: Number(r.position),
  service: s(r.service) as ProposalItem['service'],
  description: s(r.description),
  billingType: s(r.billing_type) as ProposalItem['billingType'],
  unitAmountMinor: Number(r.unit_amount_minor),
  quantity: Number(r.quantity),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const toProposal = (r: Row, items: ProposalItem[]): Proposal => ({
  id: s(r.id),
  companyId: s(r.company_id),
  title: s(r.title),
  currency: s(r.currency) as Proposal['currency'],
  contractMonths: nn(r.contract_months),
  validUntil: sn(r.valid_until),
  notes: s(r.notes),
  taxMode: s(r.tax_mode) as Proposal['taxMode'],
  taxRateBp: nn(r.tax_rate_bp),
  status: s(r.status) as Proposal['status'],
  sentAt: sn(r.sent_at),
  decidedAt: sn(r.decided_at),
  lossReason: sn(r.loss_reason),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
  items,
});

export function createSalesRepository(db: Db): SalesRepository {
  // Statements are prepared on first use, so a store can be built on a database that is still
  // being migrated (the v3 → v4 upgrade test drives real Phase 7 code against a v3 database).
  let prepared: ReturnType<typeof prepare> | null = null;
  const prepare = () => ({
    meetings: db.prepare('SELECT * FROM meetings ORDER BY scheduled_at DESC'),
    meeting: db.prepare('SELECT * FROM meetings WHERE id = ?'),
    upsertMeeting: db.prepare(`INSERT INTO meetings (id, company_id, scheduled_at, type, status, contact_id, contact_name, contact_email, notes, outcome,
      next_action_label, next_action_due_at, completed_at, created_at, updated_at)
      VALUES (:id, :company_id, :scheduled_at, :type, :status, :contact_id, :contact_name, :contact_email, :notes, :outcome,
      :next_action_label, :next_action_due_at, :completed_at, :created_at, :updated_at)
      ON CONFLICT(id) DO UPDATE SET scheduled_at = excluded.scheduled_at, type = excluded.type, status = excluded.status,
      contact_id = excluded.contact_id, contact_name = excluded.contact_name, contact_email = excluded.contact_email, notes = excluded.notes,
      outcome = excluded.outcome, next_action_label = excluded.next_action_label, next_action_due_at = excluded.next_action_due_at,
      completed_at = excluded.completed_at, updated_at = excluded.updated_at`),
    proposals: db.prepare('SELECT * FROM proposals ORDER BY updated_at DESC'),
    proposal: db.prepare('SELECT * FROM proposals WHERE id = ?'),
    items: db.prepare('SELECT * FROM proposal_items ORDER BY proposal_id, position'),
    itemsOf: db.prepare('SELECT * FROM proposal_items WHERE proposal_id = ? ORDER BY position'),
    upsertProposal: db.prepare(`INSERT INTO proposals (id, company_id, title, currency, contract_months, valid_until, notes, tax_mode, tax_rate_bp, status,
      sent_at, decided_at, loss_reason, created_at, updated_at)
      VALUES (:id, :company_id, :title, :currency, :contract_months, :valid_until, :notes, :tax_mode, :tax_rate_bp, :status,
      :sent_at, :decided_at, :loss_reason, :created_at, :updated_at)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, currency = excluded.currency, contract_months = excluded.contract_months,
      valid_until = excluded.valid_until, notes = excluded.notes, tax_mode = excluded.tax_mode, tax_rate_bp = excluded.tax_rate_bp,
      status = excluded.status, sent_at = excluded.sent_at, decided_at = excluded.decided_at, loss_reason = excluded.loss_reason,
      updated_at = excluded.updated_at`),
    delItems: db.prepare('DELETE FROM proposal_items WHERE proposal_id = ?'),
    addItem: db.prepare(`INSERT INTO proposal_items (id, proposal_id, position, service, description, billing_type, unit_amount_minor, quantity, created_at, updated_at)
      VALUES (:id, :proposal_id, :position, :service, :description, :billing_type, :unit_amount_minor, :quantity, :created_at, :updated_at)`),
  });
  const q = () => (prepared ??= prepare());

  const loadProposal = (r: Row | undefined) => (r ? toProposal(r, (q().itemsOf.all(s(r.id)) as Row[]).map(toItem)) : null);

  return {
    listMeetings: () => (q().meetings.all() as Row[]).map(toMeeting),
    getMeeting(id) {
      const r = q().meeting.get(id) as Row | undefined;
      return r ? toMeeting(r) : null;
    },
    saveMeeting(m) {
      q().upsertMeeting.run({
        id: m.id,
        company_id: m.companyId,
        scheduled_at: m.scheduledAt,
        type: m.type,
        status: m.status,
        contact_id: m.contactId,
        contact_name: m.contactName,
        contact_email: m.contactEmail,
        notes: m.notes,
        outcome: m.outcome,
        next_action_label: m.nextActionLabel,
        next_action_due_at: m.nextActionDueAt,
        completed_at: m.completedAt,
        created_at: m.createdAt,
        updated_at: m.updatedAt,
      });
    },
    listProposals() {
      const items = new Map<string, ProposalItem[]>();
      for (const r of q().items.all() as Row[]) (items.get(s(r.proposal_id)) ?? items.set(s(r.proposal_id), []).get(s(r.proposal_id))!).push(toItem(r));
      return (q().proposals.all() as Row[]).map((r) => toProposal(r, items.get(s(r.id)) ?? []));
    },
    getProposal: (id) => loadProposal(q().proposal.get(id) as Row | undefined),
    saveProposal(p) {
      transaction(db, () => {
        q().upsertProposal.run({
          id: p.id,
          company_id: p.companyId,
          title: p.title,
          currency: p.currency,
          contract_months: p.contractMonths,
          valid_until: p.validUntil,
          notes: p.notes,
          tax_mode: p.taxMode,
          tax_rate_bp: p.taxRateBp,
          status: p.status,
          sent_at: p.sentAt,
          decided_at: p.decidedAt,
          loss_reason: p.lossReason,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
        });
        q().delItems.run(p.id);
        p.items.forEach((i, position) =>
          q().addItem.run({
            id: i.id,
            proposal_id: p.id,
            position,
            service: i.service,
            description: i.description,
            billing_type: i.billingType,
            unit_amount_minor: i.unitAmountMinor,
            quantity: i.quantity,
            created_at: i.createdAt,
            updated_at: i.updatedAt,
          }),
        );
      });
    },
  };
}
