// Shared customer UI helpers (Phase 9): tones, links, the permanent no-secrets notice and the
// compact customer card shown in the company drawer.
import { BadgeCheck, KeyRound, Layers, ShieldAlert } from 'lucide-react';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import type { Company } from '../../domain/company';
import {
  CUSTOMER_SERVICE_STATUS_LABELS,
  CUSTOMER_STATUS_LABELS,
  customerBlockers,
  NO_SECRETS_WARNING,
  onboardingProgress,
  serviceDisplayName,
  type AccessStatus,
  type Customer,
  type CustomerServiceStatus,
  type CustomerStatus,
  type OnboardingStatus,
} from '../../domain/customers';
import { formatShortDate } from '../../lib/date';
import { useCustomers } from '../../state/customers/CustomersProvider';
import './customers.css';

export const CUSTOMER_TONE: Record<CustomerStatus, BadgeTone> = { onboarding: 'info', active: 'success', on_hold: 'warning', completed: 'neutral', lost: 'danger' };
export const SERVICE_TONE: Record<CustomerServiceStatus, BadgeTone> = { preparing: 'info', active: 'success', on_hold: 'warning', completed: 'neutral', cancelled: 'danger' };
export const ONBOARDING_TONE: Record<OnboardingStatus, BadgeTone> = { pending: 'neutral', in_progress: 'info', done: 'success', not_needed: 'neutral' };
export const ACCESS_TONE: Record<AccessStatus, BadgeTone> = { not_requested: 'neutral', requested: 'info', received: 'success', problem: 'danger' };

export const CLIENTS_ROUTE = '#/clients';
export const customerHref = (customerId: string) => `${CLIENTS_ROUTE}?customer=${encodeURIComponent(customerId)}`;
export const startOnboardingHref = (companyId: string, proposalId?: string | null) =>
  `${CLIENTS_ROUTE}?start=${encodeURIComponent(companyId)}${proposalId ? `&proposal=${encodeURIComponent(proposalId)}` : ''}`;

/** Always visible wherever access or notes are edited. */
export function NoSecretsNotice() {
  return (
    <p className="no-secrets" role="note">
      <ShieldAlert size={14} aria-hidden="true" /> {NO_SECRETS_WARNING} KITE yalnızca erişimin istenip alındığını takip eder.
    </p>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="onb-progress" role="img" aria-label={`Onboarding ilerlemesi: ${done} / ${total}`}>
      <span className="onb-progress__bar">
        <span className="onb-progress__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="onb-progress__text">
        {done}/{total}
      </span>
    </span>
  );
}

/** "Müşteri" card in the company drawer overview: a compact summary; details live on the Müşteriler page. */
export function CustomerSummaryCard({ company }: { company: Company }) {
  const { customerFor } = useCustomers();
  const customer = customerFor(company.id);
  if (!customer) {
    if (company.status !== 'client') return null;
    return (
      <section className="comm-summary customer-summary" aria-labelledby="customer-summary-title">
        <div className="comm-summary__head">
          <h3 id="customer-summary-title" className="comm-summary__title">
            Müşteri
          </h3>
          <a className="comm-summary__link" href={startOnboardingHref(company.id)}>
            Müşteri onboarding'ini başlat
          </a>
        </div>
        <p className="comm-summary__meta">Şirket Müşteri aşamasında ama henüz müşteri kaydı yok. Onboarding'i sen başlatırsın.</p>
      </section>
    );
  }
  return <CustomerCardBody customer={customer} />;
}

function CustomerCardBody({ customer }: { customer: Customer }) {
  const progress = onboardingProgress(customer.onboarding);
  const blockers = customerBlockers(customer, new Date().toISOString());
  const active = customer.services.filter((s) => s.status === 'active' || s.status === 'preparing');
  const received = customer.access.filter((a) => a.status === 'received').length;
  return (
    <section className="comm-summary customer-summary" aria-labelledby="customer-summary-title">
      <div className="comm-summary__head">
        <h3 id="customer-summary-title" className="comm-summary__title">
          Müşteri
        </h3>
        <Badge tone={CUSTOMER_TONE[customer.status]}>{CUSTOMER_STATUS_LABELS[customer.status]}</Badge>
      </div>
      <p className="comm-summary__row">
        <BadgeCheck size={14} aria-hidden="true" />
        <span>
          Başlangıç {formatShortDate(new Date(customer.startDate))}
          {customer.endDate && ` · bitiş ${formatShortDate(new Date(customer.endDate))}`}
        </span>
      </p>
      <p className="comm-summary__row">
        <Layers size={14} aria-hidden="true" />
        <span>{active.length ? active.map((s) => `${serviceDisplayName(s)} (${CUSTOMER_SERVICE_STATUS_LABELS[s.status]})`).join(', ') : <span className="comm-summary__meta">Aktif hizmet yok</span>}</span>
      </p>
      <p className="comm-summary__row">
        <KeyRound size={14} aria-hidden="true" />
        <span>
          Onboarding {progress.done}/{progress.total} · erişim {received}/{customer.access.length} alındı
        </span>
      </p>
      {blockers.length > 0 && <p className="sales-hint sales-hint--warn">{blockers.join(' · ')}</p>}
      <a className="comm-summary__link" href={customerHref(customer.id)}>
        Müşteri sayfasında aç
      </a>
    </section>
  );
}
