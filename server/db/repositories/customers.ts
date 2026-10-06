// SQLite customer repository (Phase 9): customers with their services, onboarding checklist and
// access requirements. A customer is read as one aggregate; child rows are saved individually.
import type { AccessRequirement, Customer, CustomerService, OnboardingItem } from '../../../src/domain/customers';
import type { Db } from '../sqlite';
import type { CustomerRepository } from './types';

type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const toService = (r: Row): CustomerService => ({
  id: s(r.id),
  customerId: s(r.customer_id),
  service: s(r.service) as CustomerService['service'],
  label: s(r.label),
  status: s(r.status) as CustomerService['status'],
  startDate: sn(r.start_date),
  endDate: sn(r.end_date),
  billingType: sn(r.billing_type) as CustomerService['billingType'],
  amountMinor: nn(r.amount_minor),
  currency: sn(r.currency) as CustomerService['currency'],
  sourceProposalId: sn(r.source_proposal_id),
  sourceItemId: sn(r.source_item_id),
  notes: s(r.notes),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const toItem = (r: Row): OnboardingItem => ({
  id: s(r.id),
  customerId: s(r.customer_id),
  position: Number(r.position),
  label: s(r.label),
  status: s(r.status) as OnboardingItem['status'],
  notes: s(r.notes),
  dueDate: sn(r.due_date),
  completedAt: sn(r.completed_at),
  templateKey: sn(r.template_key),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const toAccess = (r: Row): AccessRequirement => ({
  id: s(r.id),
  customerId: s(r.customer_id),
  position: Number(r.position),
  kind: s(r.kind) as AccessRequirement['kind'],
  label: s(r.label),
  status: s(r.status) as AccessRequirement['status'],
  requestedAt: sn(r.requested_at),
  receivedAt: sn(r.received_at),
  notes: s(r.notes),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

export function createCustomerRepository(db: Db): CustomerRepository {
  // Prepared on first use (the store may be built before migrations reach v5 in upgrade tests).
  let prepared: ReturnType<typeof prepare> | null = null;
  const prepare = () => ({
    customers: db.prepare('SELECT * FROM customers ORDER BY start_date DESC, created_at DESC'),
    customer: db.prepare('SELECT * FROM customers WHERE id = ?'),
    byCompany: db.prepare('SELECT * FROM customers WHERE company_id = ?'),
    services: db.prepare('SELECT * FROM customer_services ORDER BY customer_id, created_at, rowid'),
    servicesOf: db.prepare('SELECT * FROM customer_services WHERE customer_id = ? ORDER BY created_at, rowid'),
    service: db.prepare('SELECT * FROM customer_services WHERE id = ?'),
    items: db.prepare('SELECT * FROM onboarding_items ORDER BY customer_id, position'),
    itemsOf: db.prepare('SELECT * FROM onboarding_items WHERE customer_id = ? ORDER BY position'),
    item: db.prepare('SELECT * FROM onboarding_items WHERE id = ?'),
    access: db.prepare('SELECT * FROM access_requirements ORDER BY customer_id, position'),
    accessOf: db.prepare('SELECT * FROM access_requirements WHERE customer_id = ? ORDER BY position'),
    accessOne: db.prepare('SELECT * FROM access_requirements WHERE id = ?'),
    nextItemPos: db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM onboarding_items WHERE customer_id = ?'),
    nextAccessPos: db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM access_requirements WHERE customer_id = ?'),
    upsertCustomer: db.prepare(`INSERT INTO customers (id, company_id, status, start_date, end_date, primary_contact_id, primary_contact_name, primary_contact_email,
      source_proposal_id, commercial_notes, operational_notes, onboarding_started_at, onboarding_completed_at, created_at, updated_at)
      VALUES (:id, :company_id, :status, :start_date, :end_date, :primary_contact_id, :primary_contact_name, :primary_contact_email,
      :source_proposal_id, :commercial_notes, :operational_notes, :onboarding_started_at, :onboarding_completed_at, :created_at, :updated_at)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, start_date = excluded.start_date, end_date = excluded.end_date,
      primary_contact_id = excluded.primary_contact_id, primary_contact_name = excluded.primary_contact_name, primary_contact_email = excluded.primary_contact_email,
      source_proposal_id = excluded.source_proposal_id, commercial_notes = excluded.commercial_notes, operational_notes = excluded.operational_notes,
      onboarding_completed_at = excluded.onboarding_completed_at, updated_at = excluded.updated_at`),
    upsertService: db.prepare(`INSERT INTO customer_services (id, customer_id, service, label, status, start_date, end_date, billing_type, amount_minor, currency,
      source_proposal_id, source_item_id, notes, created_at, updated_at)
      VALUES (:id, :customer_id, :service, :label, :status, :start_date, :end_date, :billing_type, :amount_minor, :currency,
      :source_proposal_id, :source_item_id, :notes, :created_at, :updated_at)
      ON CONFLICT(id) DO UPDATE SET service = excluded.service, label = excluded.label, status = excluded.status, start_date = excluded.start_date,
      end_date = excluded.end_date, billing_type = excluded.billing_type, amount_minor = excluded.amount_minor, currency = excluded.currency,
      notes = excluded.notes, updated_at = excluded.updated_at`),
    upsertItem: db.prepare(`INSERT INTO onboarding_items (id, customer_id, position, label, status, notes, due_date, completed_at, template_key, created_at, updated_at)
      VALUES (:id, :customer_id, :position, :label, :status, :notes, :due_date, :completed_at, :template_key, :created_at, :updated_at)
      ON CONFLICT(id) DO UPDATE SET label = excluded.label, status = excluded.status, notes = excluded.notes, due_date = excluded.due_date,
      completed_at = excluded.completed_at, updated_at = excluded.updated_at`),
    deleteItem: db.prepare('DELETE FROM onboarding_items WHERE id = ?'),
    upsertAccess: db.prepare(`INSERT INTO access_requirements (id, customer_id, position, kind, label, status, requested_at, received_at, notes, created_at, updated_at)
      VALUES (:id, :customer_id, :position, :kind, :label, :status, :requested_at, :received_at, :notes, :created_at, :updated_at)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, label = excluded.label, status = excluded.status, requested_at = excluded.requested_at,
      received_at = excluded.received_at, notes = excluded.notes, updated_at = excluded.updated_at`),
    deleteAccess: db.prepare('DELETE FROM access_requirements WHERE id = ?'),
  });
  const q = () => (prepared ??= prepare());

  const toCustomer = (r: Row, services: CustomerService[], onboarding: OnboardingItem[], access: AccessRequirement[]): Customer => ({
    id: s(r.id),
    companyId: s(r.company_id),
    status: s(r.status) as Customer['status'],
    startDate: s(r.start_date),
    endDate: sn(r.end_date),
    primaryContactId: sn(r.primary_contact_id),
    primaryContactName: sn(r.primary_contact_name),
    primaryContactEmail: sn(r.primary_contact_email),
    sourceProposalId: sn(r.source_proposal_id),
    commercialNotes: s(r.commercial_notes),
    operationalNotes: s(r.operational_notes),
    onboardingStartedAt: s(r.onboarding_started_at),
    onboardingCompletedAt: sn(r.onboarding_completed_at),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
    services,
    onboarding,
    access,
  });

  const load = (r: Row | undefined) =>
    r
      ? toCustomer(r, (q().servicesOf.all(s(r.id)) as Row[]).map(toService), (q().itemsOf.all(s(r.id)) as Row[]).map(toItem), (q().accessOf.all(s(r.id)) as Row[]).map(toAccess))
      : null;

  const group = <T,>(rows: Row[], map: (r: Row) => T) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(s(r.customer_id)) ?? m.set(s(r.customer_id), []).get(s(r.customer_id))!).push(map(r));
    return m;
  };

  return {
    list() {
      const services = group(q().services.all() as Row[], toService);
      const items = group(q().items.all() as Row[], toItem);
      const access = group(q().access.all() as Row[], toAccess);
      return (q().customers.all() as Row[]).map((r) => toCustomer(r, services.get(s(r.id)) ?? [], items.get(s(r.id)) ?? [], access.get(s(r.id)) ?? []));
    },
    get: (id) => load(q().customer.get(id) as Row | undefined),
    getByCompany: (companyId) => load(q().byCompany.get(companyId) as Row | undefined),
    getService(id) {
      const r = q().service.get(id) as Row | undefined;
      return r ? toService(r) : null;
    },
    getOnboardingItem(id) {
      const r = q().item.get(id) as Row | undefined;
      return r ? toItem(r) : null;
    },
    getAccess(id) {
      const r = q().accessOne.get(id) as Row | undefined;
      return r ? toAccess(r) : null;
    },
    nextOnboardingPosition: (customerId) => Number((q().nextItemPos.get(customerId) as { p: number }).p),
    nextAccessPosition: (customerId) => Number((q().nextAccessPos.get(customerId) as { p: number }).p),
    saveCustomer(c) {
      q().upsertCustomer.run({
        id: c.id,
        company_id: c.companyId,
        status: c.status,
        start_date: c.startDate,
        end_date: c.endDate,
        primary_contact_id: c.primaryContactId,
        primary_contact_name: c.primaryContactName,
        primary_contact_email: c.primaryContactEmail,
        source_proposal_id: c.sourceProposalId,
        commercial_notes: c.commercialNotes,
        operational_notes: c.operationalNotes,
        onboarding_started_at: c.onboardingStartedAt,
        onboarding_completed_at: c.onboardingCompletedAt,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
      });
    },
    saveService(v) {
      q().upsertService.run({
        id: v.id,
        customer_id: v.customerId,
        service: v.service,
        label: v.label,
        status: v.status,
        start_date: v.startDate,
        end_date: v.endDate,
        billing_type: v.billingType,
        amount_minor: v.amountMinor,
        currency: v.currency,
        source_proposal_id: v.sourceProposalId,
        source_item_id: v.sourceItemId,
        notes: v.notes,
        created_at: v.createdAt,
        updated_at: v.updatedAt,
      });
    },
    saveOnboardingItem(i) {
      q().upsertItem.run({
        id: i.id,
        customer_id: i.customerId,
        position: i.position,
        label: i.label,
        status: i.status,
        notes: i.notes,
        due_date: i.dueDate,
        completed_at: i.completedAt,
        template_key: i.templateKey,
        created_at: i.createdAt,
        updated_at: i.updatedAt,
      });
    },
    deleteOnboardingItem: (id) => void q().deleteItem.run(id),
    saveAccess(a) {
      q().upsertAccess.run({
        id: a.id,
        customer_id: a.customerId,
        position: a.position,
        kind: a.kind,
        label: a.label,
        status: a.status,
        requested_at: a.requestedAt,
        received_at: a.receivedAt,
        notes: a.notes,
        created_at: a.createdAt,
        updated_at: a.updatedAt,
      });
    },
    deleteAccess: (id) => void q().deleteAccess.run(id),
  };
}
