// Customers (Phase 9): the operational layer after a company became a customer. Shared by the server
// (authority) and the browser (labels, templates, progress / blocked hints).
//
// Manual first: a customer record exists only after Berk explicitly starts onboarding (the company
// must be at sales stage Müşteri). Activating, completing onboarding, activating or closing services
// and marking access as received are explicit actions; nothing changes on its own.
//
// Not a vault: access requirements track only whether access was requested / received. There is no
// field for passwords, API keys or tokens, and notes that clearly contain credentials are refused.
import { dayKey } from './businessDay';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from './services';
import type { BillingType, Currency } from './sales';

// ---------- Customer ----------

export const CUSTOMER_STATUSES = ['onboarding', 'active', 'on_hold', 'completed', 'lost'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Aktif',
  on_hold: 'Beklemede',
  completed: 'Tamamlandı',
  lost: 'Kaybedildi',
};

/** Allowed customer status changes (all explicit; finished customers can be reactivated). */
export const CUSTOMER_TRANSITIONS: Record<CustomerStatus, readonly CustomerStatus[]> = {
  onboarding: ['active', 'on_hold', 'lost'],
  active: ['on_hold', 'completed', 'lost'],
  on_hold: ['active', 'onboarding', 'completed', 'lost'],
  completed: ['active'],
  lost: ['onboarding', 'active'],
};

// ---------- Services ----------

export const CUSTOMER_SERVICE_STATUSES = ['preparing', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type CustomerServiceStatus = (typeof CUSTOMER_SERVICE_STATUSES)[number];
export const CUSTOMER_SERVICE_STATUS_LABELS: Record<CustomerServiceStatus, string> = {
  preparing: 'Hazırlanıyor',
  active: 'Aktif',
  on_hold: 'Beklemede',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

export interface CustomerService {
  id: string;
  customerId: string;
  service: ServiceKey;
  /** Optional scope, e.g. "Türkiye", "Gulf", "Brand A" (several services of one type are allowed). */
  label: string;
  status: CustomerServiceStatus;
  startDate: string | null;
  endDate: string | null;
  /** Reference-only commercial metadata (copied from the accepted proposal). Never invoicing. */
  billingType: BillingType | null;
  amountMinor: number | null;
  currency: Currency | null;
  /** Loose references to where the service came from; services stay editable copies. */
  sourceProposalId: string | null;
  sourceItemId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerServiceInput {
  service: ServiceKey;
  label: string;
  billingType: BillingType | null;
  amountMinor: number | null;
  currency: Currency | null;
  sourceProposalId: string | null;
  sourceItemId: string | null;
  notes: string;
  startDate: string | null;
  endDate: string | null;
}

export const serviceDisplayName = (s: Pick<CustomerService, 'service' | 'label'>) => (s.label.trim() ? `${SERVICES[s.service].label} · ${s.label.trim()}` : SERVICES[s.service].label);

// ---------- Onboarding checklist ----------

export const ONBOARDING_STATUSES = ['pending', 'in_progress', 'done', 'not_needed'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = { pending: 'Bekliyor', in_progress: 'Devam Ediyor', done: 'Tamamlandı', not_needed: 'Gerekli Değil' };

export interface OnboardingItem {
  id: string;
  customerId: string;
  position: number;
  label: string;
  status: OnboardingStatus;
  notes: string;
  dueDate: string | null;
  completedAt: string | null;
  /** Template key it was suggested from, if any. */
  templateKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingItemInput {
  label: string;
  templateKey: string | null;
  dueDate: string | null;
  notes: string;
}

// ---------- Access requirements ----------

export const ACCESS_KINDS = ['meta_business', 'google_ads', 'ga4', 'search_console', 'website_admin', 'social_accounts', 'other'] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];
export const ACCESS_KIND_LABELS: Record<AccessKind, string> = {
  meta_business: 'Meta Business erişimi',
  google_ads: 'Google Ads erişimi',
  ga4: 'GA4 erişimi',
  search_console: 'Search Console erişimi',
  website_admin: 'Website admin erişimi',
  social_accounts: 'Sosyal medya hesap erişimi',
  other: 'Diğer erişim',
};

export const ACCESS_STATUSES = ['not_requested', 'requested', 'received', 'problem'] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];
export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = { not_requested: 'İstenmedi', requested: 'İstendi', received: 'Alındı', problem: 'Sorun Var' };

export interface AccessRequirement {
  id: string;
  customerId: string;
  position: number;
  kind: AccessKind;
  label: string;
  status: AccessStatus;
  requestedAt: string | null;
  receivedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccessInput {
  kind: AccessKind;
  label: string;
  notes: string;
}

export const NO_SECRETS_WARNING = 'Şifre, API key veya token saklamayın.';

// ---------- Customer aggregate ----------

export interface Customer {
  id: string;
  companyId: string;
  status: CustomerStatus;
  startDate: string;
  endDate: string | null;
  /** Contacts are rewritten when a company is saved, so the person is also snapshotted. */
  primaryContactId: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  /** The accepted proposal onboarding started from (optional; upsells stay possible). */
  sourceProposalId: string | null;
  commercialNotes: string;
  operationalNotes: string;
  onboardingStartedAt: string;
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  services: CustomerService[];
  onboarding: OnboardingItem[];
  access: AccessRequirement[];
}

export interface CustomerDetailsInput {
  startDate: string;
  endDate: string | null;
  primaryContactId: string | null;
  commercialNotes: string;
  operationalNotes: string;
}

export interface StartOnboardingInput extends Omit<CustomerDetailsInput, 'endDate'> {
  sourceProposalId: string | null;
  services: CustomerServiceInput[];
  onboardingItems: OnboardingItemInput[];
  accessItems: AccessInput[];
  /** Explicit, unticked by default: move the company to Müşteri if it is not there yet. */
  moveCompanyToClient: boolean;
}

// ---------- Templates (suggestions only; every customer gets its own editable rows) ----------

export interface OnboardingTemplateItem {
  key: string;
  label: string;
}

const COMMON_ONBOARDING: OnboardingTemplateItem[] = [
  { key: 'contract', label: 'Sözleşme / teklif onayı' },
  { key: 'contact', label: 'İletişim kişisi belirlendi' },
  { key: 'kickoff', label: 'Kickoff toplantısı' },
  { key: 'brand_assets', label: 'Marka materyalleri' },
  { key: 'brand_guide', label: 'Logo / font / guideline' },
  { key: 'product_info', label: 'Ürün / hizmet bilgileri' },
];

const SERVICE_ONBOARDING: Record<ServiceKey, OnboardingTemplateItem[]> = {
  meta_ads: [
    { key: 'audience', label: 'Hedef kitle bilgileri' },
    { key: 'past_ads', label: 'Geçmiş reklam verileri' },
  ],
  google_ads: [
    { key: 'audience', label: 'Hedef kitle bilgileri' },
    { key: 'past_ads', label: 'Geçmiş reklam verileri' },
    { key: 'keywords', label: 'Hedef anahtar kelimeler / bölgeler' },
  ],
  website: [
    { key: 'site_content', label: 'Website içerikleri (metin / görsel)' },
    { key: 'sitemap', label: 'Sayfa yapısı onayı' },
  ],
  seo: [{ key: 'seo_targets', label: 'Hedef anahtar kelimeler' }],
  social_media: [
    { key: 'audience', label: 'Hedef kitle bilgileri' },
    { key: 'content_calendar', label: 'İçerik takvimi onayı' },
  ],
  creative: [{ key: 'creative_brief', label: 'Kreatif brief' }],
  crm: [
    { key: 'crm_process', label: 'Mevcut satış / müşteri süreci' },
    { key: 'crm_data', label: 'Mevcut müşteri verisi' },
  ],
};

const SERVICE_ACCESS: Record<ServiceKey, AccessKind[]> = {
  meta_ads: ['meta_business'],
  google_ads: ['google_ads', 'ga4'],
  website: ['website_admin', 'ga4'],
  seo: ['search_console', 'ga4', 'website_admin'],
  social_media: ['social_accounts', 'meta_business'],
  creative: [],
  crm: [],
};

/** Suggested checklist for a set of services (common items first, no duplicates). */
export function suggestedOnboarding(services: readonly ServiceKey[]): OnboardingTemplateItem[] {
  const out = [...COMMON_ONBOARDING];
  for (const s of SERVICE_KEYS) if (services.includes(s)) for (const i of SERVICE_ONBOARDING[s]) if (!out.some((x) => x.key === i.key)) out.push(i);
  return out;
}

/** Suggested access requirements for a set of services (no duplicates). */
export function suggestedAccess(services: readonly ServiceKey[]): AccessKind[] {
  const out: AccessKind[] = [];
  for (const s of SERVICE_KEYS) if (services.includes(s)) for (const k of SERVICE_ACCESS[s]) if (!out.includes(k)) out.push(k);
  return out;
}

// ---------- Progress and blocked state (derived, never stored) ----------

export function onboardingProgress(items: readonly Pick<OnboardingItem, 'status'>[]): { done: number; total: number; open: number } {
  const relevant = items.filter((i) => i.status !== 'not_needed');
  const done = relevant.filter((i) => i.status === 'done').length;
  return { done, total: relevant.length, open: relevant.length - done };
}

/** Open checklist items whose due date has passed (shared with the dashboard). */
export const overdueOnboardingItems = (items: readonly OnboardingItem[], now: string): OnboardingItem[] =>
  items.filter((i) => i.dueDate && dayKey(i.dueDate) < dayKey(now) && (i.status === 'pending' || i.status === 'in_progress'));

/** Why the customer is blocked (Turkish), empty when nothing blocks it. */
export function customerBlockers(c: Pick<Customer, 'status' | 'onboarding' | 'access'>, now: string): string[] {
  if (c.status === 'completed' || c.status === 'lost') return [];
  const out: string[] = [];
  const problems = c.access.filter((a) => a.status === 'problem');
  if (problems.length) out.push(`Erişim sorunu: ${problems.map((a) => a.label).join(', ')}`);
  const overdue = overdueOnboardingItems(c.onboarding, now);
  if (overdue.length) out.push(`Gecikmiş onboarding adımı: ${overdue.map((i) => i.label).join(', ')}`);
  return out;
}

// ---------- No secrets ----------

/**
 * Clear credential patterns ("password:", "şifre:", "api key:", "secret:", "token:", bearer values).
 * Deliberately narrow: long or random-looking text alone is NOT refused (false positives).
 */
const SECRET_PATTERN = /(?:^|[^\p{L}])(?:password|passwd|parola|şifre|sifre|api[\s_-]?key|apikey|secret|client[\s_-]?secret|access[\s_-]?token|refresh[\s_-]?token|token)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/iu;

export const containsSecret = (text: string | null | undefined): boolean => !!text && SECRET_PATTERN.test(text);

// ---------- Errors ----------

export type CustomerErrorCode =
  | 'customer_not_found'
  | 'customer_exists'
  | 'customer_stage_required'
  | 'customer_invalid_transition'
  | 'customer_onboarding_open'
  | 'customer_invalid'
  | 'customer_secret'
  | 'customer_contact_missing'
  | 'customer_proposal_invalid';

export const CUSTOMER_ERROR_MESSAGES: Record<CustomerErrorCode, string> = {
  customer_not_found: 'Müşteri kaydı bulunamadı.',
  customer_exists: 'Bu şirket için zaten bir müşteri kaydı var.',
  customer_stage_required: 'Onboarding yalnızca satış aşaması Müşteri olan şirketler için başlatılabilir. Şirketi Müşteri aşamasına taşımayı seç.',
  customer_invalid_transition: 'Müşteri bu duruma geçirilemez.',
  customer_onboarding_open: 'Açık onboarding adımları var. Yine de tamamlamak için onayla.',
  customer_invalid: 'Gönderilen bilgiler geçersiz.',
  customer_secret: 'Şifre, API key veya token saklamayın. Bu alanda erişim bilgisi gibi görünen bir değer var; kaldırıp tekrar dene.',
  customer_contact_missing: 'Seçilen iletişim kişisi bu şirkette bulunamadı.',
  customer_proposal_invalid: 'Onboarding yalnızca bu şirketin kabul edilmiş bir teklifinden başlatılabilir.',
};
