// Pure company construction and migration, shared by the browser and the persistence server so a
// company is built the same way everywhere. No React, no I/O.
import {
  CURRENT_USER,
  type Company,
  type CompanyNote,
  type CompanySize,
  type CompanySource,
  type Contact,
  type ResearchReference,
  type ServiceOpportunity,
} from '../../domain/company';
import type { SalesStatus } from '../../domain/salesStatus';
import { normalizeSectorInput } from '../../domain/sectorTaxonomy';
import { createId } from '../../lib/id';
import { describe, historyEntry } from './events';

export interface NewCompanyInput {
  name: string;
  website: string | null;
  sector: string;
  city: string;
  country: string;
  source: CompanySource;
  opportunities: ServiceOpportunity[];
  opportunityScore: number | null;
  status: SalesStatus;
  owner: string | null;
  note: string;
  companySize?: CompanySize | null;
  /** Where the company came from, recorded on the first history entry (e.g. "Araştırma: …"). */
  origin?: string;
  /** Overrides "Şirket sisteme eklendi" on the first history entry. */
  createdMessage?: string;
  /** Initial contacts (e.g. public business contacts found by research). */
  contacts?: ContactInput[];
  researchRef?: ResearchReference;
}

export type ContactInput = Omit<Contact, 'id'>;

/** Builds a complete new company record (history, contacts, first note) from form or transfer input. */
export function buildNewCompany(input: NewCompanyInput, at = new Date().toISOString(), author: string = CURRENT_USER): Company {
  const history = [historyEntry('created', describe.created(input.origin, input.createdMessage), at, author)];
  const contacts: Contact[] = (input.contacts ?? []).map((c) => ({ ...c, id: createId('ct') }));
  for (const c of contacts) history.unshift(historyEntry('contact_added', describe.contactAdded(c.fullName), at, author));
  const notes: CompanyNote[] = [];
  if (input.note.trim()) {
    notes.push({ id: createId('note'), content: input.note.trim(), author, createdAt: at });
    history.unshift(historyEntry('note_added', describe.noteAdded(), at, author));
  }
  return {
    id: createId('cmp'),
    name: input.name,
    website: input.website,
    ...normalizeSectorInput(input.sector),
    city: input.city,
    country: input.country,
    companySize: input.companySize ?? null,
    source: input.source,
    owner: input.owner,
    status: input.status,
    opportunityScore: input.opportunityScore,
    opportunities: input.opportunities,
    contacts,
    notes,
    history,
    lastContactAt: null,
    nextAction: null,
    createdAt: at,
    updatedAt: at,
    ...(input.researchRef ? { researchRef: input.researchRef } : {}),
  };
}

/**
 * Sector migration for stored companies: legacy or alias values ("Transfer", "Dental Clinic")
 * become the Turkish catalogue label plus sector id; custom sectors are kept as typed.
 */
export function migrateCompanySector(c: Company): Company {
  if (c.sectorId !== undefined) return c;
  return { ...c, ...normalizeSectorInput(c.sector) };
}

/** Meta for reducer actions: who, when, and pre-generated history ids. */
export function actionMeta(at = new Date().toISOString(), author: string = CURRENT_USER) {
  return { at, author, eventIds: [1, 2, 3].map(() => createId('evt')) };
}
