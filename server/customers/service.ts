// Customer service (Phase 9): onboarding, customer services, checklist and access requirements.
//
// Rules enforced here (the browser only mirrors them):
//   - A customer is created only by an explicit "start onboarding" request, and only for a company at
//     sales stage Müşteri. If the company is not there yet, the request must explicitly ask for the
//     move (`moveCompanyToClient`); the move is a normal status change (history + Phase 7 rules).
//   - Every lifecycle change is explicit: activating / completing onboarding, pausing, completing,
//     activating or closing services, requesting / receiving access. Nothing happens on a timer.
//   - The responsible person is the company's existing owner field (normal company history).
//   - No secrets: free text that clearly contains credentials is refused.
//   - Every change is one transaction with its company history entry.
import type { Company } from '../../src/domain/company';
import {
  ACCESS_KIND_LABELS,
  ACCESS_STATUS_LABELS,
  containsSecret,
  CUSTOMER_ERROR_MESSAGES,
  CUSTOMER_SERVICE_STATUS_LABELS,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_TRANSITIONS,
  onboardingProgress,
  serviceDisplayName,
  type AccessInput,
  type AccessRequirement,
  type AccessStatus,
  type Customer,
  type CustomerDetailsInput,
  type CustomerErrorCode,
  type CustomerService,
  type CustomerServiceInput,
  type CustomerServiceStatus,
  type CustomerStatus,
  type OnboardingItem,
  type OnboardingItemInput,
  type OnboardingStatus,
  type StartOnboardingInput,
} from '../../src/domain/customers';
import type { SalesStatus } from '../../src/domain/salesStatus';
import { formatShortDate } from '../../src/lib/date';
import { createId } from '../../src/lib/id';
import { actionMeta } from '../../src/state/companies/companyCommands';
import { companiesReducer, type CompaniesAction } from '../../src/state/companies/companiesReducer';
import type { Store } from '../db/store';
import type { FollowUpPlanner } from '../followUp/service';

const HTTP: Record<CustomerErrorCode, number> = {
  customer_not_found: 404,
  customer_exists: 409,
  customer_stage_required: 409,
  customer_invalid_transition: 409,
  customer_onboarding_open: 409,
  customer_invalid: 400,
  customer_secret: 400,
  customer_contact_missing: 400,
  customer_proposal_invalid: 400,
};

export class CustomerError extends Error {
  readonly status: number;
  constructor(
    public readonly code: CustomerErrorCode,
    message?: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message ?? CUSTOMER_ERROR_MESSAGES[code]);
    this.name = 'CustomerError';
    this.status = HTTP[code];
  }
}

export interface CustomerStatusChange {
  to: CustomerStatus;
  /** Completing onboarding with open checklist items needs this explicit confirmation. */
  confirmOpenItems?: boolean;
  /** End date for Tamamlandı / Kaybedildi (defaults to today). */
  date?: string | null;
  /** Explicit, optional company stage move (e.g. Kaybedildi). */
  moveCompanyTo?: SalesStatus | null;
}

const day = (iso: string) => iso.slice(0, 10);

export function createCustomerService(store: Store, deps: { now?: () => Date; followUps?: FollowUpPlanner | null } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  function companyOf(id: string): Company {
    const c = store.companies.get(id);
    if (!c) throw new CustomerError('customer_not_found', 'Şirket bulunamadı.');
    return c;
  }

  function apply(id: string, make: (meta: ReturnType<typeof actionMeta>) => CompaniesAction, at: string): Company {
    const current = companyOf(id);
    const [next] = companiesReducer([current], make(actionMeta(at)));
    if (next !== current) store.companies.save(next);
    return next;
  }

  const history = (companyId: string, event: 'customer' | 'customer_service' | 'onboarding' | 'access', description: string, at: string) =>
    apply(companyId, (meta) => ({ type: 'customerEvent', id: companyId, event, description, meta }), at);

  /** Explicitly requested stage move, as a normal status change (history + follow-up rules). */
  function moveStage(companyId: string, to: SalesStatus | null | undefined, at: string): void {
    if (!to || companyOf(companyId).status === to) return;
    const next = apply(companyId, (meta) => ({ type: 'changeStatus', id: companyId, status: to, meta }), at);
    deps.followUps?.onCompanyStatus(next, at);
  }

  const noSecrets = (...texts: (string | null | undefined)[]) => {
    if (texts.some(containsSecret)) throw new CustomerError('customer_secret');
  };

  function customerOf(id: string): Customer {
    const c = store.customers.get(id);
    if (!c) throw new CustomerError('customer_not_found');
    return c;
  }

  function contactSnapshot(company: Company, contactId: string | null) {
    if (!contactId) return { primaryContactId: null, primaryContactName: null, primaryContactEmail: null };
    const c = company.contacts.find((x) => x.id === contactId);
    if (!c) throw new CustomerError('customer_contact_missing');
    return { primaryContactId: c.id, primaryContactName: c.fullName || null, primaryContactEmail: c.email ?? null };
  }

  function newService(customerId: string, input: CustomerServiceInput, at: string): CustomerService {
    noSecrets(input.label, input.notes);
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw new CustomerError('customer_invalid', 'Hizmet bitiş tarihi başlangıçtan önce olamaz.');
    return { id: createId('csv'), customerId, ...input, label: input.label.trim(), notes: input.notes.trim(), status: 'preparing', createdAt: at, updatedAt: at };
  }

  function newOnboardingItem(customerId: string, input: OnboardingItemInput, position: number, at: string): OnboardingItem {
    noSecrets(input.label, input.notes);
    return { id: createId('onb'), customerId, position, label: input.label.trim(), status: 'pending', notes: input.notes.trim(), dueDate: input.dueDate, completedAt: null, templateKey: input.templateKey, createdAt: at, updatedAt: at };
  }

  function newAccess(customerId: string, input: AccessInput, position: number, at: string): AccessRequirement {
    noSecrets(input.label, input.notes);
    return { id: createId('acc'), customerId, position, kind: input.kind, label: (input.label.trim() || ACCESS_KIND_LABELS[input.kind]), status: 'not_requested', requestedAt: null, receivedAt: null, notes: input.notes.trim(), createdAt: at, updatedAt: at };
  }

  const result = (customerId: string) => {
    const customer = customerOf(customerId);
    return { customer, company: companyOf(customer.companyId) };
  };

  return {
    list: () => ({ customers: store.customers.list() }),

    /**
     * "Müşteri onboarding'ini başlat": creates the customer (Onboarding) with the chosen services
     * (Hazırlanıyor), checklist and access items. Never activates anything.
     */
    startOnboarding(companyId: string, input: StartOnboardingInput) {
      return store.transaction(() => {
        const at = now();
        const company = companyOf(companyId);
        if (store.customers.getByCompany(companyId)) throw new CustomerError('customer_exists');
        if (company.status !== 'client' && !input.moveCompanyToClient) throw new CustomerError('customer_stage_required');
        noSecrets(input.commercialNotes, input.operationalNotes);
        if (input.sourceProposalId) {
          const p = store.sales.getProposal(input.sourceProposalId);
          if (!p || p.companyId !== companyId || p.status !== 'accepted') throw new CustomerError('customer_proposal_invalid');
        }
        // The stage move first (explicitly requested), so the customer starts from Müşteri.
        if (company.status !== 'client') moveStage(companyId, 'client', at);
        const id = createId('cus');
        store.customers.saveCustomer({
          id,
          companyId,
          status: 'onboarding',
          startDate: input.startDate,
          endDate: null,
          ...contactSnapshot(company, input.primaryContactId),
          sourceProposalId: input.sourceProposalId,
          commercialNotes: input.commercialNotes.trim(),
          operationalNotes: input.operationalNotes.trim(),
          onboardingStartedAt: at,
          onboardingCompletedAt: null,
          createdAt: at,
          updatedAt: at,
        });
        for (const svc of input.services) store.customers.saveService(newService(id, svc, at));
        input.onboardingItems.forEach((i, position) => store.customers.saveOnboardingItem(newOnboardingItem(id, i, position, at)));
        input.accessItems.forEach((a, position) => store.customers.saveAccess(newAccess(id, a, position, at)));
        history(
          companyId,
          'customer',
          `Müşteri onboarding'i başlatıldı: başlangıç ${formatShortDate(new Date(input.startDate))}${input.services.length ? ` · ${input.services.length} hizmet` : ''}${input.sourceProposalId ? ' · kabul edilen tekliften' : ''}`,
          at,
        );
        return result(id);
      });
    },

    /** Customer details; `owner` (optional) updates the company's existing responsible person. */
    updateCustomer(id: string, input: CustomerDetailsInput, owner?: string | null) {
      return store.transaction(() => {
        const at = now();
        const current = customerOf(id);
        noSecrets(input.commercialNotes, input.operationalNotes);
        if (input.endDate && input.endDate < input.startDate) throw new CustomerError('customer_invalid', 'Bitiş tarihi başlangıçtan önce olamaz.');
        const company = companyOf(current.companyId);
        const snapshot = input.primaryContactId === current.primaryContactId ? { primaryContactId: current.primaryContactId, primaryContactName: current.primaryContactName, primaryContactEmail: current.primaryContactEmail } : contactSnapshot(company, input.primaryContactId);
        const { services: _s, onboarding: _o, access: _a, ...row } = current;
        store.customers.saveCustomer({ ...row, ...input, ...snapshot, commercialNotes: input.commercialNotes.trim(), operationalNotes: input.operationalNotes.trim(), updatedAt: at });
        if (owner !== undefined && owner !== company.owner) apply(company.id, (meta) => ({ type: 'updateDetails', id: company.id, patch: { owner }, meta }), at);
        return result(id);
      });
    },

    /** Explicit customer status change (incl. "Onboarding'i tamamla" = Onboarding → Aktif). */
    changeStatus(id: string, c: CustomerStatusChange) {
      return store.transaction(() => {
        const at = now();
        const current = customerOf(id);
        if (!CUSTOMER_TRANSITIONS[current.status].includes(c.to)) {
          throw new CustomerError('customer_invalid_transition', `Müşteri “${CUSTOMER_STATUS_LABELS[current.status]}” durumundan “${CUSTOMER_STATUS_LABELS[c.to]}” durumuna geçirilemez.`);
        }
        const { services: _s, onboarding: _o, access: _a, ...row } = current;
        const next = { ...row, status: c.to, updatedAt: at };
        const completingOnboarding = current.status === 'onboarding' && c.to === 'active';
        if (completingOnboarding) {
          const open = onboardingProgress(current.onboarding).open;
          if (open > 0 && !c.confirmOpenItems) throw new CustomerError('customer_onboarding_open', `${open} açık onboarding adımı var. Yine de tamamlamak için onayla.`, { open });
          next.onboardingCompletedAt = at;
        }
        if (c.to === 'onboarding') next.onboardingCompletedAt = null;
        if (c.to === 'completed' || c.to === 'lost') {
          const end = c.date ?? at;
          if (day(end) < day(current.startDate)) throw new CustomerError('customer_invalid', 'Bitiş tarihi başlangıçtan önce olamaz.');
          next.endDate = end < current.startDate ? current.startDate : end; // same day, earlier hour
        }
        if (c.to === 'active' || c.to === 'onboarding') next.endDate = null; // reactivated / resumed
        store.customers.saveCustomer(next);
        history(
          current.companyId,
          completingOnboarding ? 'onboarding' : 'customer',
          completingOnboarding ? `Onboarding tamamlandı; müşteri Aktif` : `Müşteri durumu: ${CUSTOMER_STATUS_LABELS[current.status]} → ${CUSTOMER_STATUS_LABELS[c.to]}`,
          at,
        );
        moveStage(current.companyId, c.moveCompanyTo, at);
        return result(id);
      });
    },

    // ---------- Services ----------

    addService(customerId: string, input: CustomerServiceInput) {
      return store.transaction(() => {
        const at = now();
        const customer = customerOf(customerId);
        const svc = newService(customerId, input, at);
        store.customers.saveService(svc);
        history(customer.companyId, 'customer_service', `Hizmet eklendi: ${serviceDisplayName(svc)} (Hazırlanıyor)`, at);
        return result(customerId);
      });
    },

    /** Edits a service's content; the status changes only through changeServiceStatus. */
    updateService(id: string, input: CustomerServiceInput) {
      return store.transaction(() => {
        const at = now();
        const current = store.customers.getService(id);
        if (!current) throw new CustomerError('customer_not_found', 'Hizmet bulunamadı.');
        noSecrets(input.label, input.notes);
        if (input.startDate && input.endDate && input.endDate < input.startDate) throw new CustomerError('customer_invalid', 'Hizmet bitiş tarihi başlangıçtan önce olamaz.');
        store.customers.saveService({ ...current, ...input, sourceProposalId: current.sourceProposalId, sourceItemId: current.sourceItemId, label: input.label.trim(), notes: input.notes.trim(), updatedAt: at });
        return result(current.customerId);
      });
    },

    /** Explicit service status change; activation sets the start date, closing sets the end date. */
    changeServiceStatus(id: string, to: CustomerServiceStatus, date?: string | null) {
      return store.transaction(() => {
        const at = now();
        const current = store.customers.getService(id);
        if (!current) throw new CustomerError('customer_not_found', 'Hizmet bulunamadı.');
        if (current.status === to) throw new CustomerError('customer_invalid_transition', 'Hizmet zaten bu durumda.');
        const customer = customerOf(current.customerId);
        const next: CustomerService = { ...current, status: to, updatedAt: at };
        if (to === 'active') {
          next.startDate = current.startDate ?? date ?? at;
          next.endDate = null;
        }
        if (to === 'completed' || to === 'cancelled') next.endDate = date ?? at;
        if (to === 'preparing' || to === 'on_hold') next.endDate = null;
        if (next.startDate && next.endDate && day(next.endDate) < day(next.startDate)) throw new CustomerError('customer_invalid', 'Hizmet bitiş tarihi başlangıçtan önce olamaz.');
        if (next.startDate && next.endDate && next.endDate < next.startDate) next.endDate = next.startDate; // same day, earlier hour
        store.customers.saveService(next);
        history(customer.companyId, 'customer_service', `Hizmet ${serviceDisplayName(current)}: ${CUSTOMER_SERVICE_STATUS_LABELS[current.status]} → ${CUSTOMER_SERVICE_STATUS_LABELS[to]}`, at);
        return result(customer.id);
      });
    },

    // ---------- Onboarding checklist ----------

    addOnboardingItems(customerId: string, items: OnboardingItemInput[]) {
      return store.transaction(() => {
        const at = now();
        customerOf(customerId);
        let position = store.customers.nextOnboardingPosition(customerId);
        for (const i of items) store.customers.saveOnboardingItem(newOnboardingItem(customerId, i, position++, at));
        return result(customerId);
      });
    },

    updateOnboardingItem(id: string, input: { label: string; notes: string; dueDate: string | null }) {
      return store.transaction(() => {
        const current = store.customers.getOnboardingItem(id);
        if (!current) throw new CustomerError('customer_not_found', 'Onboarding adımı bulunamadı.');
        noSecrets(input.label, input.notes);
        store.customers.saveOnboardingItem({ ...current, label: input.label.trim(), notes: input.notes.trim(), dueDate: input.dueDate, updatedAt: now() });
        return result(current.customerId);
      });
    },

    /** Checklist item status (operational detail: no history entry per item). */
    setOnboardingStatus(id: string, to: OnboardingStatus) {
      return store.transaction(() => {
        const at = now();
        const current = store.customers.getOnboardingItem(id);
        if (!current) throw new CustomerError('customer_not_found', 'Onboarding adımı bulunamadı.');
        store.customers.saveOnboardingItem({ ...current, status: to, completedAt: to === 'done' ? (current.completedAt ?? at) : null, updatedAt: at });
        return result(current.customerId);
      });
    },

    deleteOnboardingItem(id: string) {
      return store.transaction(() => {
        const current = store.customers.getOnboardingItem(id);
        if (!current) throw new CustomerError('customer_not_found', 'Onboarding adımı bulunamadı.');
        store.customers.deleteOnboardingItem(id);
        return result(current.customerId);
      });
    },

    // ---------- Access requirements (status only, never credentials) ----------

    addAccess(customerId: string, items: AccessInput[]) {
      return store.transaction(() => {
        const at = now();
        customerOf(customerId);
        let position = store.customers.nextAccessPosition(customerId);
        for (const a of items) store.customers.saveAccess(newAccess(customerId, a, position++, at));
        return result(customerId);
      });
    },

    updateAccess(id: string, input: { label: string; notes: string }) {
      return store.transaction(() => {
        const current = store.customers.getAccess(id);
        if (!current) throw new CustomerError('customer_not_found', 'Erişim kaydı bulunamadı.');
        noSecrets(input.label, input.notes);
        store.customers.saveAccess({ ...current, label: input.label.trim() || ACCESS_KIND_LABELS[current.kind], notes: input.notes.trim(), updatedAt: now() });
        return result(current.customerId);
      });
    },

    /** İstendi / Alındı / Sorun Var are explicit; requested/received dates are recorded. */
    setAccessStatus(id: string, to: AccessStatus) {
      return store.transaction(() => {
        const at = now();
        const current = store.customers.getAccess(id);
        if (!current) throw new CustomerError('customer_not_found', 'Erişim kaydı bulunamadı.');
        if (current.status === to) throw new CustomerError('customer_invalid_transition', 'Erişim zaten bu durumda.');
        const customer = customerOf(current.customerId);
        const next: AccessRequirement = {
          ...current,
          status: to,
          requestedAt: to === 'not_requested' ? null : (current.requestedAt ?? at),
          receivedAt: to === 'received' ? at : null,
          updatedAt: at,
        };
        store.customers.saveAccess(next);
        history(customer.companyId, 'access', `${current.label}: ${ACCESS_STATUS_LABELS[current.status]} → ${ACCESS_STATUS_LABELS[to]}`, at);
        return result(customer.id);
      });
    },

    deleteAccess(id: string) {
      return store.transaction(() => {
        const current = store.customers.getAccess(id);
        if (!current) throw new CustomerError('customer_not_found', 'Erişim kaydı bulunamadı.');
        store.customers.deleteAccess(id);
        return result(current.customerId);
      });
    },
  };
}

export type CustomerServiceApi = ReturnType<typeof createCustomerService>;
