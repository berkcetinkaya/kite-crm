// SQLite company repository. A company is stored relationally: one row in companies plus child rows
// for contacts, notes, history and opportunities. Research provenance (researchRef) is a JSON
// snapshot with its job id also kept as a column.
import type { Company, CompanyHistoryEntry, CompanyNote, Contact, ResearchReference, ServiceOpportunity } from '../../../src/domain/company';
import { countryMatchKey } from '../../../src/domain/locations';
import { findProspectMatch } from '../../../src/domain/research';
import { foldForSearch } from '../../../src/lib/text';
import { websiteHost } from '../../../src/lib/url';
import { fromJson, toJson, transaction, type Db } from '../sqlite';
import type { CompanyRepository } from './types';

type Row = Record<string, unknown>;

const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const nameKey = (name: string) => foldForSearch(name.trim());

function toCompany(r: Row, children: { contacts: Contact[]; notes: CompanyNote[]; history: CompanyHistoryEntry[]; opportunities: ServiceOpportunity[] }): Company {
  const researchRef = fromJson<ResearchReference>(r.research_ref_json);
  return {
    id: s(r.id),
    name: s(r.name),
    website: sn(r.website),
    sector: s(r.sector),
    sectorId: sn(r.sector_id),
    city: s(r.city),
    country: s(r.country),
    companySize: sn(r.company_size) as Company['companySize'],
    source: s(r.source) as Company['source'],
    owner: sn(r.owner),
    status: s(r.status) as Company['status'],
    opportunityScore: nn(r.opportunity_score),
    opportunities: children.opportunities,
    contacts: children.contacts,
    notes: children.notes,
    history: children.history,
    lastContactAt: sn(r.last_contact_at),
    nextAction: r.next_action_label ? { label: s(r.next_action_label), dueAt: sn(r.next_action_due_at) } : null,
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
    ...(researchRef ? { researchRef } : {}),
  };
}

export function createCompanyRepository(db: Db): CompanyRepository {
  const q = {
    all: db.prepare('SELECT * FROM companies ORDER BY created_at DESC, rowid DESC'),
    one: db.prepare('SELECT * FROM companies WHERE id = ?'),
    contacts: db.prepare('SELECT * FROM company_contacts ORDER BY company_id, position'),
    notes: db.prepare('SELECT * FROM company_notes ORDER BY company_id, position'),
    history: db.prepare('SELECT * FROM company_history ORDER BY company_id, position'),
    opps: db.prepare('SELECT * FROM company_opportunities ORDER BY company_id, position'),
    contactsOf: db.prepare('SELECT * FROM company_contacts WHERE company_id = ? ORDER BY position'),
    notesOf: db.prepare('SELECT * FROM company_notes WHERE company_id = ? ORDER BY position'),
    historyOf: db.prepare('SELECT * FROM company_history WHERE company_id = ? ORDER BY position'),
    oppsOf: db.prepare('SELECT * FROM company_opportunities WHERE company_id = ? ORDER BY position'),
    insert: db.prepare(`INSERT INTO companies (id, name, website, website_host, name_key, sector, sector_id, city, country, country_key,
      company_size, source, owner, status, opportunity_score, last_contact_at, next_action_label, next_action_due_at,
      research_job_id, research_ref_json, created_at, updated_at)
      VALUES (:id, :name, :website, :website_host, :name_key, :sector, :sector_id, :city, :country, :country_key,
      :company_size, :source, :owner, :status, :opportunity_score, :last_contact_at, :next_action_label, :next_action_due_at,
      :research_job_id, :research_ref_json, :created_at, :updated_at)`),
    update: db.prepare(`UPDATE companies SET name = :name, website = :website, website_host = :website_host, name_key = :name_key,
      sector = :sector, sector_id = :sector_id, city = :city, country = :country, country_key = :country_key,
      company_size = :company_size, source = :source, owner = :owner, status = :status, opportunity_score = :opportunity_score,
      last_contact_at = :last_contact_at, next_action_label = :next_action_label, next_action_due_at = :next_action_due_at,
      research_job_id = :research_job_id, research_ref_json = :research_ref_json, created_at = :created_at, updated_at = :updated_at
      WHERE id = :id`),
    delContacts: db.prepare('DELETE FROM company_contacts WHERE company_id = ?'),
    delNotes: db.prepare('DELETE FROM company_notes WHERE company_id = ?'),
    delHistory: db.prepare('DELETE FROM company_history WHERE company_id = ?'),
    delOpps: db.prepare('DELETE FROM company_opportunities WHERE company_id = ?'),
    addContact: db.prepare(`INSERT INTO company_contacts (id, company_id, position, full_name, role, email, phone, linkedin, is_decision_maker, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    addNote: db.prepare('INSERT INTO company_notes (id, company_id, position, content, author, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    addHistory: db.prepare('INSERT INTO company_history (id, company_id, position, type, description, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    addOpp: db.prepare('INSERT INTO company_opportunities (company_id, position, service, score, potential, reason) VALUES (?, ?, ?, ?, ?, ?)'),
    dupCandidates: db.prepare('SELECT id FROM companies WHERE (website_host IS NOT NULL AND website_host = ?) OR name_key = ?'),
  };

  const contact = (r: Row): Contact => ({
    id: s(r.id),
    fullName: s(r.full_name),
    role: s(r.role),
    email: sn(r.email),
    phone: sn(r.phone),
    linkedin: sn(r.linkedin),
    isDecisionMaker: Number(r.is_decision_maker) === 1,
    confidence: s(r.confidence) as Contact['confidence'],
  });
  const note = (r: Row): CompanyNote => ({ id: s(r.id), content: s(r.content), author: s(r.author), createdAt: s(r.created_at) });
  const event = (r: Row): CompanyHistoryEntry => ({
    id: s(r.id),
    type: s(r.type) as CompanyHistoryEntry['type'],
    description: s(r.description),
    author: s(r.author),
    createdAt: s(r.created_at),
  });
  const opp = (r: Row): ServiceOpportunity => ({
    service: s(r.service) as ServiceOpportunity['service'],
    score: nn(r.score),
    potential: sn(r.potential) as ServiceOpportunity['potential'],
    reason: s(r.reason),
  });

  function params(c: Company) {
    return {
      id: c.id,
      name: c.name,
      website: c.website,
      website_host: websiteHost(c.website),
      name_key: nameKey(c.name),
      sector: c.sector,
      sector_id: c.sectorId ?? null,
      city: c.city,
      country: c.country,
      country_key: countryMatchKey(c.country),
      company_size: c.companySize,
      source: c.source,
      owner: c.owner,
      status: c.status,
      opportunity_score: c.opportunityScore,
      last_contact_at: c.lastContactAt,
      next_action_label: c.nextAction?.label ?? null,
      next_action_due_at: c.nextAction?.dueAt ?? null,
      research_job_id: c.researchRef?.requestId ?? null,
      research_ref_json: toJson(c.researchRef),
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    };
  }

  function writeChildren(c: Company) {
    c.contacts.forEach((x, i) => q.addContact.run(x.id, c.id, i, x.fullName, x.role, x.email, x.phone, x.linkedin, x.isDecisionMaker ? 1 : 0, x.confidence));
    c.notes.forEach((x, i) => q.addNote.run(x.id, c.id, i, x.content, x.author, x.createdAt));
    c.history.forEach((x, i) => q.addHistory.run(x.id, c.id, i, x.type, x.description, x.author, x.createdAt));
    c.opportunities.forEach((x, i) => q.addOpp.run(c.id, i, x.service, x.score, x.potential, x.reason));
  }

  function get(id: string): Company | null {
    const r = q.one.get(id) as Row | undefined;
    if (!r) return null;
    return toCompany(r, {
      contacts: (q.contactsOf.all(id) as Row[]).map(contact),
      notes: (q.notesOf.all(id) as Row[]).map(note),
      history: (q.historyOf.all(id) as Row[]).map(event),
      opportunities: (q.oppsOf.all(id) as Row[]).map(opp),
    });
  }

  return {
    list() {
      const group = <T,>(rows: Row[], map: (r: Row) => T) => {
        const out = new Map<string, T[]>();
        for (const r of rows) {
          const k = s(r.company_id);
          (out.get(k) ?? out.set(k, []).get(k)!).push(map(r));
        }
        return out;
      };
      const contacts = group(q.contacts.all() as Row[], contact);
      const notes = group(q.notes.all() as Row[], note);
      const history = group(q.history.all() as Row[], event);
      const opps = group(q.opps.all() as Row[], opp);
      return (q.all.all() as Row[]).map((r) => {
        const id = s(r.id);
        return toCompany(r, { contacts: contacts.get(id) ?? [], notes: notes.get(id) ?? [], history: history.get(id) ?? [], opportunities: opps.get(id) ?? [] });
      });
    },
    get,
    insert(c) {
      transaction(db, () => {
        q.insert.run(params(c));
        writeChildren(c);
      });
    },
    save(c) {
      transaction(db, () => {
        const res = q.update.run(params(c));
        if (Number(res.changes) === 0) throw new Error(`Company ${c.id} does not exist`);
        q.delContacts.run(c.id);
        q.delNotes.run(c.id);
        q.delHistory.run(c.id);
        q.delOpps.run(c.id);
        writeChildren(c);
      });
    },
    findDuplicate(candidate) {
      const host = websiteHost(candidate.website);
      const ids = (q.dupCandidates.all(host, nameKey(candidate.name)) as Row[]).map((r) => s(r.id));
      // The domain rule decides (website host first, then name + canonical country).
      const companies = ids.map((id) => get(id)).filter((c): c is Company => c !== null);
      return findProspectMatch(candidate, companies);
    },
  };
}
