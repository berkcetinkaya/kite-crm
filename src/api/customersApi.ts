// Browser client for customers (Phase 9): onboarding, services, checklist and access tracking.
// Nothing here sends email, invoices or stores credentials.
import type { Company } from '../domain/company';
import type {
  AccessInput,
  AccessStatus,
  Customer,
  CustomerDetailsInput,
  CustomerServiceInput,
  CustomerServiceStatus,
  CustomerStatus,
  OnboardingItemInput,
  OnboardingStatus,
  StartOnboardingInput,
} from '../domain/customers';
import type { SalesStatus } from '../domain/salesStatus';
import { request } from './dataApi';

export interface CustomerStatusInput {
  to: CustomerStatus;
  confirmOpenItems?: boolean;
  date?: string | null;
  moveCompanyTo?: SalesStatus | null;
}

export type CustomerResult = { customer: Customer; company: Company };

export const customersApi = {
  list: (signal?: AbortSignal) => request<{ customers: Customer[] }>('GET', '/api/customers', undefined, signal),
  start: (companyId: string, onboarding: StartOnboardingInput) => request<CustomerResult>('POST', '/api/customers', { companyId, onboarding }),
  update: (id: string, customer: CustomerDetailsInput, owner?: string | null) => request<CustomerResult>('PUT', `/api/customers/${id}`, { customer, ...(owner !== undefined ? { owner } : {}) }),
  changeStatus: (id: string, input: CustomerStatusInput) => request<CustomerResult>('POST', `/api/customers/${id}/status`, input),
  addService: (id: string, service: CustomerServiceInput) => request<CustomerResult>('POST', `/api/customers/${id}/services`, { service }),
  updateService: (id: string, service: CustomerServiceInput) => request<CustomerResult>('PUT', `/api/customers/services/${id}`, { service }),
  serviceStatus: (id: string, to: CustomerServiceStatus, date?: string | null) => request<CustomerResult>('POST', `/api/customers/services/${id}/status`, { to, date: date ?? null }),
  addOnboarding: (id: string, items: OnboardingItemInput[]) => request<CustomerResult>('POST', `/api/customers/${id}/onboarding`, { items }),
  updateOnboarding: (id: string, input: { label: string; notes: string; dueDate: string | null }) => request<CustomerResult>('PUT', `/api/customers/onboarding/${id}`, input),
  onboardingStatus: (id: string, to: OnboardingStatus) => request<CustomerResult>('POST', `/api/customers/onboarding/${id}/status`, { to }),
  deleteOnboarding: (id: string) => request<CustomerResult>('POST', `/api/customers/onboarding/${id}/delete`, {}),
  addAccess: (id: string, items: AccessInput[]) => request<CustomerResult>('POST', `/api/customers/${id}/access`, { items }),
  updateAccess: (id: string, input: { label: string; notes: string }) => request<CustomerResult>('PUT', `/api/customers/access/${id}`, input),
  accessStatus: (id: string, to: AccessStatus) => request<CustomerResult>('POST', `/api/customers/access/${id}/status`, { to }),
  deleteAccess: (id: string) => request<CustomerResult>('POST', `/api/customers/access/${id}/delete`, {}),
};

export type CustomersApi = typeof customersApi;
