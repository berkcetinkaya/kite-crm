// Sales service (Phase 8): meetings and proposals after a prospect replied.
//
// Rules enforced here (the browser only mirrors them):
//   - Nothing moves a company's sales stage unless the request explicitly asks for it
//     (`moveCompanyTo`). The move uses the same status action as the status select, so the history
//     entry and the Phase 7 follow-up rules (pause / stop) apply exactly as for a manual change.
//   - A service is added to the company's opportunities only when explicitly listed
//     (`addOpportunities`); never because it appears in a proposal.
//   - Proposal content is editable only in Taslak / Gönderilmeye Hazır; sent proposals change only
//     through explicit, reversible status transitions. Nothing is emailed, generated or invoiced.
//   - Every change is one transaction: record + company history (+ requested stage move).
import type { Company } from '../../src/domain/company';
import {
  canTransition,
  formatMoney,
  isEditableProposal,
  MEETING_TYPE_LABELS,
  PROPOSAL_STATUS_LABELS,
  proposalTotals,
  SALES_ERROR_MESSAGES,
  type Meeting,
  type MeetingInput,
  type Proposal,
  type ProposalInput,
  type ProposalStatus,
  type SalesErrorCode,
} from '../../src/domain/sales';
import type { SalesStatus } from '../../src/domain/salesStatus';
import type { ServiceKey } from '../../src/domain/services';
import { formatDateTime, formatShortDate } from '../../src/lib/date';
import { createId } from '../../src/lib/id';
import { actionMeta } from '../../src/state/companies/companyCommands';
import { companiesReducer, type CompaniesAction } from '../../src/state/companies/companiesReducer';
import type { Store } from '../db/store';
import type { FollowUpPlanner } from '../followUp/service';

const HTTP: Record<SalesErrorCode, number> = { sales_not_found: 404, sales_invalid_transition: 409, sales_locked: 409, sales_invalid: 400, sales_contact_missing: 400 };

export class SalesError extends Error {
  readonly status: number;
  constructor(
    public readonly code: SalesErrorCode,
    message?: string,
  ) {
    super(message ?? SALES_ERROR_MESSAGES[code]);
    this.name = 'SalesError';
    this.status = HTTP[code];
  }
}

export interface StageMove {
  /** Explicit stage move requested together with the action; null/absent = keep the stage. */
  moveCompanyTo?: SalesStatus | null;
}

export interface MeetingCompletion extends StageMove {
  outcome: string;
  notes: string;
  nextActionLabel: string | null;
  nextActionDueAt: string | null;
  /** Also store the meeting's next action as the company's "Sonraki Adım". */
  setCompanyNextAction: boolean;
}

export interface ProposalTransition extends StageMove {
  to: ProposalStatus;
  /** Gönderildi: when Berk sent it (defaults to now). */
  sentAt?: string | null;
  /** Kabul Edildi / Reddedildi: when it was decided (defaults to now). */
  decidedAt?: string | null;
  /** Reddedildi: required. */
  lossReason?: string | null;
}

const when = (iso: string) => formatDateTime(new Date(iso));

export function createSalesService(store: Store, deps: { now?: () => Date; followUps?: FollowUpPlanner | null } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  function companyOf(id: string): Company {
    const c = store.companies.get(id);
    if (!c) throw new SalesError('sales_not_found', 'Şirket bulunamadı.');
    return c;
  }

  function apply(id: string, make: (meta: ReturnType<typeof actionMeta>) => CompaniesAction, at: string): Company {
    const current = companyOf(id);
    const [next] = companiesReducer([current], make(actionMeta(at)));
    if (next !== current) store.companies.save(next);
    return next;
  }

  const history = (companyId: string, event: 'meeting' | 'proposal', description: string, at: string) =>
    apply(companyId, (meta) => ({ type: 'salesEvent', id: companyId, event, description, meta }), at);

  /** The explicitly requested stage move, as a normal status change (history + follow-up rules). */
  function moveStage(companyId: string, to: SalesStatus | null | undefined, at: string): void {
    if (!to) return;
    const before = companyOf(companyId);
    if (before.status === to) return;
    const next = apply(companyId, (meta) => ({ type: 'changeStatus', id: companyId, status: to, meta }), at);
    deps.followUps?.onCompanyStatus(next, at);
  }

  function addOpportunities(companyId: string, services: readonly ServiceKey[], at: string): void {
    const c = companyOf(companyId);
    const missing = services.filter((s, i) => services.indexOf(s) === i && !c.opportunities.some((o) => o.service === s));
    if (!missing.length) return;
    const opportunities = [...c.opportunities, ...missing.map((service) => ({ service, score: null, potential: null, reason: '' }))];
    apply(companyId, (meta) => ({ type: 'setOpportunities', id: companyId, opportunities, meta }), at);
  }

  function contactSnapshot(company: Company, contactId: string | null) {
    if (!contactId) return { contactId: null, contactName: null, contactEmail: null };
    const c = company.contacts.find((x) => x.id === contactId);
    if (!c) throw new SalesError('sales_contact_missing');
    return { contactId: c.id, contactName: c.fullName || null, contactEmail: c.email ?? null };
  }

  function meetingOf(id: string): Meeting {
    const m = store.sales.getMeeting(id);
    if (!m) throw new SalesError('sales_not_found');
    return m;
  }

  function proposalOf(id: string): Proposal {
    const p = store.sales.getProposal(id);
    if (!p) throw new SalesError('sales_not_found');
    return p;
  }

  function buildItems(proposalId: string, input: ProposalInput, previous: Proposal | null, at: string): Proposal['items'] {
    return input.items.map((i, position) => {
      const same = previous?.items[position];
      const unchanged = same && same.service === i.service && same.description === i.description && same.billingType === i.billingType && same.unitAmountMinor === i.unitAmountMinor && same.quantity === i.quantity;
      return {
        id: same?.id ?? createId('pit'),
        proposalId,
        position,
        service: i.service,
        description: i.description,
        billingType: i.billingType,
        unitAmountMinor: i.unitAmountMinor,
        quantity: i.quantity,
        createdAt: same?.createdAt ?? at,
        updatedAt: unchanged ? same.updatedAt : at,
      };
    });
  }

  const totalsText = (p: Proposal) => {
    const t = proposalTotals(p.items);
    const parts = [t.oneTimeMinor ? `tek seferlik ${formatMoney(t.oneTimeMinor, p.currency)}` : null, t.monthlyMinor ? `aylık ${formatMoney(t.monthlyMinor, p.currency)}` : null].filter(Boolean);
    return parts.length ? ` · ${parts.join(', ')}` : '';
  };

  const result = <T,>(record: T, companyId: string) => ({ ...record, company: companyOf(companyId) });

  return {
    list: () => ({ meetings: store.sales.listMeetings(), proposals: store.sales.listProposals() }),

    // ---------- Meetings ----------

    /** Plans (or records) a meeting. Never changes the stage unless `moveCompanyTo` is given. */
    createMeeting(companyId: string, input: MeetingInput, opts: StageMove = {}) {
      return store.transaction(() => {
        const at = now();
        const company = companyOf(companyId);
        const meeting: Meeting = {
          id: createId('mtg'),
          companyId,
          scheduledAt: input.scheduledAt,
          type: input.type,
          status: 'planned',
          ...contactSnapshot(company, input.contactId),
          notes: input.notes,
          outcome: input.outcome,
          nextActionLabel: input.nextActionLabel,
          nextActionDueAt: input.nextActionDueAt,
          completedAt: null,
          createdAt: at,
          updatedAt: at,
        };
        store.sales.saveMeeting(meeting);
        history(companyId, 'meeting', `Görüşme planlandı: ${when(meeting.scheduledAt)} · ${MEETING_TYPE_LABELS[meeting.type]}${meeting.contactName ? ` · ${meeting.contactName}` : ''}`, at);
        moveStage(companyId, opts.moveCompanyTo, at);
        return result({ meeting }, companyId);
      });
    },

    /** Edits a meeting's details (any status). */
    updateMeeting(id: string, input: MeetingInput) {
      return store.transaction(() => {
        const at = now();
        const current = meetingOf(id);
        const company = companyOf(current.companyId);
        const meeting: Meeting = { ...current, ...input, ...contactSnapshot(company, input.contactId), updatedAt: at };
        store.sales.saveMeeting(meeting);
        return result({ meeting }, current.companyId);
      });
    },

    /** Marks a meeting completed with its outcome. Never marks the company as customer. */
    completeMeeting(id: string, c: MeetingCompletion) {
      return store.transaction(() => {
        const at = now();
        const current = meetingOf(id);
        if (current.status === 'completed') throw new SalesError('sales_invalid_transition', 'Bu görüşme zaten tamamlandı.');
        const meeting: Meeting = { ...current, status: 'completed', outcome: c.outcome, notes: c.notes, nextActionLabel: c.nextActionLabel, nextActionDueAt: c.nextActionDueAt, completedAt: at, updatedAt: at };
        store.sales.saveMeeting(meeting);
        history(current.companyId, 'meeting', `Görüşme tamamlandı: ${when(meeting.scheduledAt)}${c.outcome.trim() ? ` · Sonuç: ${c.outcome.trim().slice(0, 140)}` : ''}`, at);
        if (c.setCompanyNextAction && c.nextActionLabel) {
          apply(current.companyId, (meta) => ({ type: 'updateDetails', id: current.companyId, patch: { nextAction: { label: c.nextActionLabel!, dueAt: c.nextActionDueAt } }, meta }), at);
        }
        moveStage(current.companyId, c.moveCompanyTo, at);
        return result({ meeting }, current.companyId);
      });
    },

    cancelMeeting(id: string) {
      return store.transaction(() => {
        const at = now();
        const current = meetingOf(id);
        if (current.status !== 'planned') throw new SalesError('sales_invalid_transition', 'Yalnızca planlanmış bir görüşme iptal edilebilir.');
        const meeting: Meeting = { ...current, status: 'cancelled', updatedAt: at };
        store.sales.saveMeeting(meeting);
        history(current.companyId, 'meeting', `Görüşme iptal edildi: ${when(meeting.scheduledAt)}`, at);
        return result({ meeting }, current.companyId);
      });
    },

    // ---------- Proposals ----------

    /** Creates a proposal (Taslak). Services become opportunities only when listed in `addOpportunities`. */
    createProposal(companyId: string, input: ProposalInput, opts: { addOpportunities?: ServiceKey[] } = {}) {
      return store.transaction(() => {
        const at = now();
        companyOf(companyId);
        const id = createId('prp');
        const proposal: Proposal = {
          id,
          companyId,
          title: input.title,
          currency: input.currency,
          contractMonths: input.contractMonths,
          validUntil: input.validUntil,
          notes: input.notes,
          taxMode: input.taxMode,
          taxRateBp: input.taxRateBp,
          status: 'draft',
          sentAt: null,
          decidedAt: null,
          lossReason: null,
          createdAt: at,
          updatedAt: at,
          items: [],
        };
        proposal.items = buildItems(id, input, null, at);
        store.sales.saveProposal(proposal);
        history(companyId, 'proposal', `Teklif oluşturuldu: “${proposal.title}”${totalsText(proposal)}`, at);
        addOpportunities(companyId, opts.addOpportunities ?? [], at);
        return result({ proposal: store.sales.getProposal(id)! }, companyId);
      });
    },

    /** Edits a Taslak / Gönderilmeye Hazır proposal (content and items). */
    updateProposal(id: string, input: ProposalInput, opts: { addOpportunities?: ServiceKey[] } = {}) {
      return store.transaction(() => {
        const at = now();
        const current = proposalOf(id);
        if (!isEditableProposal(current.status)) throw new SalesError('sales_locked');
        if (current.status === 'ready' && input.items.length === 0) throw new SalesError('sales_invalid', 'Gönderilmeye hazır bir teklifte en az bir kalem olmalı.');
        const proposal: Proposal = { ...current, ...input, items: buildItems(id, input, current, at), updatedAt: at };
        store.sales.saveProposal(proposal);
        addOpportunities(current.companyId, opts.addOpportunities ?? [], at);
        return result({ proposal: store.sales.getProposal(id)! }, current.companyId);
      });
    },

    /** Explicit, reversible status change; the company stage moves only when requested. */
    transitionProposal(id: string, t: ProposalTransition) {
      return store.transaction(() => {
        const at = now();
        const current = proposalOf(id);
        if (!canTransition(current.status, t.to)) throw new SalesError('sales_invalid_transition', `Teklif “${PROPOSAL_STATUS_LABELS[current.status]}” durumundan “${PROPOSAL_STATUS_LABELS[t.to]}” durumuna geçirilemez.`);
        const next: Proposal = { ...current, status: t.to, updatedAt: at };
        switch (t.to) {
          case 'ready':
            if (current.items.length === 0) throw new SalesError('sales_invalid', 'Teklif hazır olarak işaretlenmeden önce en az bir kalem eklenmeli.');
            break;
          case 'draft':
            // Reopened for revision: it will be sent again, so the previous send and decision are cleared.
            Object.assign(next, { sentAt: null, decidedAt: null, lossReason: null });
            break;
          case 'sent':
            // First send, or a decision reopened (the original send date is kept).
            Object.assign(next, { sentAt: current.status === 'ready' ? (t.sentAt ?? at) : (current.sentAt ?? t.sentAt ?? at), decidedAt: null, lossReason: null });
            break;
          case 'accepted':
            Object.assign(next, { decidedAt: t.decidedAt ?? at, lossReason: null });
            break;
          case 'rejected':
            if (!t.lossReason?.trim()) throw new SalesError('sales_invalid', 'Reddedilen teklif için bir neden yaz.');
            Object.assign(next, { decidedAt: t.decidedAt ?? at, lossReason: t.lossReason.trim() });
            break;
          case 'expired':
            Object.assign(next, { decidedAt: null, lossReason: null });
            break;
        }
        // Dates Berk records must be plausible: not in the future (one day of slack for time zones)
        // and a decision never before the send.
        const latest = new Date(at).getTime() + 86_400_000;
        if (next.sentAt && next.sentAt !== current.sentAt && new Date(next.sentAt).getTime() > latest) throw new SalesError('sales_invalid', 'Gönderim tarihi ileri bir tarih olamaz.');
        if (next.decidedAt && (t.to === 'accepted' || t.to === 'rejected')) {
          if (new Date(next.decidedAt).getTime() > latest) throw new SalesError('sales_invalid', 'Karar tarihi ileri bir tarih olamaz.');
          if (next.sentAt && next.decidedAt.slice(0, 10) < next.sentAt.slice(0, 10)) throw new SalesError('sales_invalid', 'Karar tarihi gönderim tarihinden önce olamaz.');
        }
        store.sales.saveProposal(next);
        const extra = t.to === 'sent' && current.status === 'ready' ? ` · gönderim: ${formatShortDate(new Date(next.sentAt!))}` : t.to === 'rejected' ? ` · neden: ${next.lossReason}` : '';
        history(current.companyId, 'proposal', `Teklif “${current.title}”: ${PROPOSAL_STATUS_LABELS[current.status]} → ${PROPOSAL_STATUS_LABELS[t.to]}${extra}`, at);
        moveStage(current.companyId, t.moveCompanyTo, at);
        return result({ proposal: store.sales.getProposal(id)! }, current.companyId);
      });
    },
  };
}

export type SalesService = ReturnType<typeof createSalesService>;
