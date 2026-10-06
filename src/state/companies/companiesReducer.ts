// Pure company state transitions. Ids and timestamps are created by the caller (CompaniesProvider)
// so the reducer stays deterministic. A future API layer can replace the provider's dispatch calls
// with requests and keep these shapes.
import {
  type Company,
  type CompanyHistoryEntry,
  type CompanyNote,
  type Contact,
  type ServiceOpportunity,
} from '../../domain/company';
import type { SalesStatus } from '../../domain/salesStatus';
import { statusAfterReply, statusAfterSend } from '../../domain/outreach';
import { COMPANY_FIELD_LABELS, describe } from './events';

/** Company fields editable from the detail drawer's "Genel Bakış" form. */
export type CompanyDetailsPatch = Partial<
  Pick<
    Company,
    | 'name'
    | 'website'
    | 'sector'
    | 'sectorId'
    | 'city'
    | 'country'
    | 'companySize'
    | 'source'
    | 'owner'
    | 'status'
    | 'opportunityScore'
    | 'lastContactAt'
    | 'nextAction'
  >
>;

/** Fields every action carries: who did it, when, and pre-generated ids for any history entries. */
interface Meta {
  at: string;
  author: string;
  /** Pre-generated ids for history entries; the reducer takes them in order. */
  eventIds: string[];
}

export type CompaniesAction =
  | { type: 'add'; company: Company }
  | { type: 'updateDetails'; id: string; patch: CompanyDetailsPatch; meta: Meta }
  | { type: 'changeStatus'; id: string; status: SalesStatus; meta: Meta }
  | { type: 'setOpportunities'; id: string; opportunities: ServiceOpportunity[]; meta: Meta }
  | { type: 'addNote'; id: string; note: CompanyNote; meta: Meta }
  | { type: 'addContact'; id: string; contact: Contact; meta: Meta }
  | { type: 'updateContact'; id: string; contact: Contact; meta: Meta }
  /** A first contact mail was confirmed sent by Gmail (Phase 6). */
  | { type: 'emailSent'; id: string; recipient: string; subject: string; sentAt: string; meta: Meta }
  /** A new reply arrived in a KITE Gmail thread (Phase 6). */
  | { type: 'replyReceived'; id: string; from: string; meta: Meta }
  /** A follow up was confirmed sent (Phase 7). Updates the last contact; never the sales status. */
  | { type: 'followUpSent'; id: string; step: number; recipient: string; sentAt: string; meta: Meta }
  /** A follow up plan event (Phase 7), recorded in the history only. */
  | { type: 'followUpEvent'; id: string; description: string; meta: Meta }
  /** A meeting or proposal event (Phase 8), recorded in the history only. Never changes the stage. */
  | { type: 'salesEvent'; id: string; event: 'meeting' | 'proposal'; description: string; meta: Meta };

type EventDraft = Pick<CompanyHistoryEntry, 'type' | 'description'>;

function withEvents(company: Company, changes: Partial<Company>, events: EventDraft[], meta: Meta): Company {
  if (events.length === 0) return company;
  const entries: CompanyHistoryEntry[] = events.map((e, i) => ({
    ...e,
    id: meta.eventIds[i] ?? `${meta.at}_${i}`,
    createdAt: meta.at,
    author: meta.author,
  }));
  return {
    ...company,
    ...changes,
    history: [...entries.reverse(), ...company.history],
    updatedAt: meta.at,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function applyDetails(company: Company, patch: CompanyDetailsPatch, meta: Meta): Company {
  const events: EventDraft[] = [];
  const changedFields: string[] = [];

  for (const key of Object.keys(patch) as (keyof CompanyDetailsPatch)[]) {
    if (sameValue(company[key], patch[key])) continue;
    if (key === 'sectorId') continue; // follows the sector field; recorded as "Sektör" 
    if (key === 'status') {
      events.push({ type: 'status_changed', description: describe.statusChanged(company.status, patch.status!) });
    } else if (key === 'opportunityScore') {
      events.push({
        type: 'score_updated',
        description: describe.scoreUpdated(company.opportunityScore, patch.opportunityScore ?? null),
      });
    } else {
      changedFields.push(COMPANY_FIELD_LABELS[key] ?? key);
    }
  }
  if (changedFields.length > 0) {
    events.unshift({ type: 'details_updated', description: describe.detailsUpdated(changedFields) });
  }
  return withEvents(company, patch, events, meta);
}

function mapCompany(state: Company[], id: string, fn: (c: Company) => Company): Company[] {
  return state.map((c) => (c.id === id ? fn(c) : c));
}

export function companiesReducer(state: Company[], action: CompaniesAction): Company[] {
  switch (action.type) {
    case 'add':
      return [action.company, ...state];

    case 'updateDetails':
      return mapCompany(state, action.id, (c) => applyDetails(c, action.patch, action.meta));

    case 'changeStatus':
      return mapCompany(state, action.id, (c) => applyDetails(c, { status: action.status }, action.meta));

    case 'setOpportunities':
      return mapCompany(state, action.id, (c) =>
        sameValue(c.opportunities, action.opportunities)
          ? c
          : withEvents(
              c,
              { opportunities: action.opportunities },
              [{ type: 'opportunities_updated', description: describe.opportunitiesUpdated() }],
              action.meta,
            ),
      );

    case 'addNote':
      return mapCompany(state, action.id, (c) =>
        withEvents(
          c,
          { notes: [action.note, ...c.notes] },
          [{ type: 'note_added', description: describe.noteAdded() }],
          action.meta,
        ),
      );

    case 'addContact':
      return mapCompany(state, action.id, (c) =>
        withEvents(
          c,
          { contacts: [...c.contacts, action.contact] },
          [{ type: 'contact_added', description: describe.contactAdded(action.contact.fullName) }],
          action.meta,
        ),
      );

    case 'emailSent':
      return mapCompany(state, action.id, (c) => {
        const status = statusAfterSend(c.status);
        const events: EventDraft[] = [{ type: 'email_sent', description: describe.emailSent(action.recipient, action.subject) }];
        if (status !== c.status) events.push({ type: 'status_changed', description: describe.statusChanged(c.status, status) });
        const lastContactAt = !c.lastContactAt || c.lastContactAt < action.sentAt ? action.sentAt : c.lastContactAt;
        return withEvents(c, { status, lastContactAt }, events, action.meta);
      });

    case 'replyReceived':
      return mapCompany(state, action.id, (c) => {
        const status = statusAfterReply(c.status);
        const events: EventDraft[] = [{ type: 'reply_received', description: describe.replyReceived(action.from) }];
        if (status !== c.status) events.push({ type: 'status_changed', description: describe.statusChanged(c.status, status) });
        return withEvents(c, { status }, events, action.meta);
      });

    case 'followUpSent':
      return mapCompany(state, action.id, (c) => {
        const lastContactAt = !c.lastContactAt || c.lastContactAt < action.sentAt ? action.sentAt : c.lastContactAt;
        return withEvents(c, { lastContactAt }, [{ type: 'follow_up_sent', description: describe.followUpSent(action.step, action.recipient) }], action.meta);
      });

    case 'followUpEvent':
      return mapCompany(state, action.id, (c) => withEvents(c, {}, [{ type: 'follow_up', description: action.description }], action.meta));

    case 'salesEvent':
      return mapCompany(state, action.id, (c) => withEvents(c, {}, [{ type: action.event, description: action.description }], action.meta));

    case 'updateContact':
      return mapCompany(state, action.id, (c) => {
        const current = c.contacts.find((x) => x.id === action.contact.id);
        if (!current || sameValue(current, action.contact)) return c;
        return withEvents(
          c,
          { contacts: c.contacts.map((x) => (x.id === action.contact.id ? action.contact : x)) },
          [{ type: 'contact_updated', description: describe.contactUpdated(action.contact.fullName) }],
          action.meta,
        );
      });
  }
}
