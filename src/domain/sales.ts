// Sales process after a reply (Phase 8): meetings and proposals. Shared by the server (authority)
// and the browser (labels, totals, allowed actions).
//
// Manual first: nothing here changes a company's sales stage on its own. When a proposal or a
// meeting suggests a stage (e.g. "Gönderildi" → Karar Bekleniyor), moving the company is always an
// explicit choice in the same request, and every move stays reversible with the status select.
import type { SalesStatus } from './salesStatus';
import { SERVICE_KEYS, type ServiceKey } from './services';

// ---------- Meetings ----------

export const MEETING_TYPES = ['online', 'phone', 'in_person'] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export const MEETING_TYPE_LABELS: Record<MeetingType, string> = { online: 'Online', phone: 'Telefon', in_person: 'Yüz yüze' };

export const MEETING_STATUSES = ['planned', 'completed', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = { planned: 'Planlandı', completed: 'Tamamlandı', cancelled: 'İptal edildi' };

export interface Meeting {
  id: string;
  companyId: string;
  /** UTC. */
  scheduledAt: string;
  type: MeetingType;
  status: MeetingStatus;
  /** Contacts are rewritten when a company is saved, so the person is also snapshotted. */
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string;
  outcome: string;
  nextActionLabel: string | null;
  nextActionDueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields Berk enters for a meeting. */
export interface MeetingInput {
  scheduledAt: string;
  type: MeetingType;
  contactId: string | null;
  notes: string;
  outcome: string;
  nextActionLabel: string | null;
  nextActionDueAt: string | null;
}

// ---------- Proposals ----------

/**
 * draft    → Taslak: being written
 * ready    → Gönderilmeye Hazır: checked, not sent yet
 * sent     → Gönderildi: Berk sent it himself (KITE never emails proposals in Phase 8)
 * accepted → Kabul Edildi
 * rejected → Reddedildi (with a reason)
 * expired  → Süresi Doldu (marked by Berk; nothing expires automatically)
 */
export const PROPOSAL_STATUSES = ['draft', 'ready', 'sent', 'accepted', 'rejected', 'expired'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Taslak',
  ready: 'Gönderilmeye Hazır',
  sent: 'Gönderildi',
  accepted: 'Kabul Edildi',
  rejected: 'Reddedildi',
  expired: 'Süresi Doldu',
};

/** Allowed status changes. Every decision can be reopened (nothing is irreversible). */
export const PROPOSAL_TRANSITIONS: Record<ProposalStatus, readonly ProposalStatus[]> = {
  draft: ['ready'],
  ready: ['draft', 'sent'],
  sent: ['accepted', 'rejected', 'expired', 'draft'],
  accepted: ['sent', 'draft'],
  rejected: ['sent', 'draft'],
  expired: ['sent', 'draft'],
};

export const canTransition = (from: ProposalStatus, to: ProposalStatus) => PROPOSAL_TRANSITIONS[from].includes(to);

/** Content can be edited only before sending (reopen to Taslak to revise a sent proposal). */
export const isEditableProposal = (status: ProposalStatus) => status === 'draft' || status === 'ready';

/** Stage a proposal status suggests for the company. Only applied when Berk ticks it. */
export const SUGGESTED_STAGE: Partial<Record<ProposalStatus, SalesStatus>> = {
  sent: 'awaiting_decision',
  accepted: 'client',
  rejected: 'lost',
};

export const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP', 'AED'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const TAX_MODES = ['excluded', 'included', 'unspecified'] as const;
export type TaxMode = (typeof TAX_MODES)[number];
export const TAX_MODE_LABELS: Record<TaxMode, string> = { excluded: 'KDV hariç', included: 'KDV dahil', unspecified: 'Vergi belirtilmedi' };

export const BILLING_TYPES = ['one_time', 'monthly'] as const;
export type BillingType = (typeof BILLING_TYPES)[number];
export const BILLING_TYPE_LABELS: Record<BillingType, string> = { one_time: 'Tek seferlik', monthly: 'Aylık' };

export const MAX_PROPOSAL_ITEMS = 20;
export const MAX_CONTRACT_MONTHS = 120;
/** Largest amount per item in minor units (100 million in the main unit). */
export const MAX_AMOUNT_MINOR = 10_000_000_000;

export interface ProposalItem {
  id: string;
  proposalId: string;
  position: number;
  service: ServiceKey;
  description: string;
  billingType: BillingType;
  /** Unit price in minor currency units (kuruş / cent). */
  unitAmountMinor: number;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface Proposal {
  id: string;
  companyId: string;
  title: string;
  currency: Currency;
  contractMonths: number | null;
  validUntil: string | null;
  notes: string;
  taxMode: TaxMode;
  /** Commercial metadata only, in basis points (2000 = %20). No tax is calculated. */
  taxRateBp: number | null;
  status: ProposalStatus;
  sentAt: string | null;
  decidedAt: string | null;
  lossReason: string | null;
  createdAt: string;
  updatedAt: string;
  items: ProposalItem[];
}

export interface ProposalItemInput {
  service: ServiceKey;
  description: string;
  billingType: BillingType;
  unitAmountMinor: number;
  quantity: number;
}

export interface ProposalInput {
  title: string;
  currency: Currency;
  contractMonths: number | null;
  validUntil: string | null;
  notes: string;
  taxMode: TaxMode;
  taxRateBp: number | null;
  items: ProposalItemInput[];
}

/** One-time and monthly recurring totals are kept apart: never one misleading grand total. */
export function proposalTotals(items: readonly Pick<ProposalItem, 'billingType' | 'unitAmountMinor' | 'quantity'>[]): { oneTimeMinor: number; monthlyMinor: number } {
  let oneTimeMinor = 0;
  let monthlyMinor = 0;
  for (const i of items) {
    const line = i.unitAmountMinor * i.quantity;
    if (i.billingType === 'monthly') monthlyMinor += line;
    else oneTimeMinor += line;
  }
  return { oneTimeMinor, monthlyMinor };
}

export const proposalServices = (p: Pick<Proposal, 'items'>): ServiceKey[] => SERVICE_KEYS.filter((s) => p.items.some((i) => i.service === s));

/** "₺12.500,00" style amount (Turkish formatting, no conversion). */
export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
}

/** "12.500,50" (user input) → 1250050 minor units; null when not a valid non-negative amount. */
export function parseAmountToMinor(text: string): number | null {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return null;
  // Turkish input: "." groups thousands, "," is the decimal separator. A lone "." with 1-2 decimals is also accepted.
  const normalized = /,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : /^\d+\.\d{1,2}$/.test(t) ? t : t.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const minor = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(minor) && minor <= MAX_AMOUNT_MINOR ? minor : null;
}

export const minorToInput = (minor: number) => (minor / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

// ---------- Errors ----------

export type SalesErrorCode = 'sales_not_found' | 'sales_invalid_transition' | 'sales_locked' | 'sales_invalid' | 'sales_contact_missing';

export const SALES_ERROR_MESSAGES: Record<SalesErrorCode, string> = {
  sales_not_found: 'Görüşme veya teklif bulunamadı.',
  sales_invalid_transition: 'Teklif bu duruma geçirilemez.',
  sales_locked: 'Gönderilmiş bir teklif düzenlenemez. Düzenlemek için önce taslağa geri al.',
  sales_invalid: 'Gönderilen bilgiler geçersiz.',
  sales_contact_missing: 'Seçilen iletişim kişisi bu şirkette bulunamadı.',
};
