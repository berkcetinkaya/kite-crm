// Prospect/company domain model. Shared by the Potansiyel Müşteriler module and future phases
// (research, outreach, pipeline, proposals). All dates are ISO 8601 strings.
import type { SalesStatus } from './salesStatus';
import type { ServiceKey } from './services';
import type { EvidenceSourceType } from './research';

export type PotentialLevel = 'high' | 'medium' | 'low';

export const POTENTIAL_LEVELS: Record<PotentialLevel, string> = {
  high: 'Yüksek Potansiyel',
  medium: 'Orta Potansiyel',
  low: 'Düşük Potansiyel',
};

export const POTENTIAL_ORDER: readonly PotentialLevel[] = ['high', 'medium', 'low'];

export interface ServiceOpportunity {
  service: ServiceKey;
  /** 0–100, entered manually. Null until someone scores it. */
  score: number | null;
  reason: string;
  potential: PotentialLevel | null;
}

export type ContactConfidence = 'high' | 'medium' | 'low';

export const CONTACT_CONFIDENCE: Record<ContactConfidence, string> = {
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
};

export const CONTACT_CONFIDENCE_ORDER: readonly ContactConfidence[] = ['high', 'medium', 'low'];

export interface Contact {
  id: string;
  fullName: string;
  role: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  isDecisionMaker: boolean;
  /** How sure we are that the contact details are correct and current. */
  confidence: ContactConfidence;
}

export interface CompanyNote {
  id: string;
  content: string;
  author: string;
  createdAt: string;
}

/**
 * Timeline event types. Later phases extend this union (email_sent, follow_up, meeting_scheduled,
 * proposal_sent, payment_received, …) without changing how the timeline renders.
 */
export type CompanyHistoryType =
  | 'created'
  | 'status_changed'
  | 'score_updated'
  | 'details_updated'
  | 'opportunities_updated'
  | 'note_added'
  | 'contact_added'
  | 'contact_updated'
  | 'email_sent'
  | 'reply_received'
  /** Phase 7: a follow up was confirmed sent in the same Gmail conversation. */
  | 'follow_up_sent'
  /** Phase 7: plan created, paused, resumed, postponed, skipped, stopped or completed. */
  | 'follow_up'
  /** Phase 8: meeting planned, completed or cancelled. */
  | 'meeting'
  /** Phase 8: proposal created or its status changed. */
  | 'proposal'
  /** Phase 9: customer onboarding started or customer status changed. */
  | 'customer'
  /** Phase 9: customer service added or its status changed. */
  | 'customer_service'
  /** Phase 9: onboarding completed. */
  | 'onboarding'
  /** Phase 9: access requested / received / problem. */
  | 'access'
  | 'task'
  /** Phase 14: a sales interaction outside KITE (WhatsApp, phone, in person), recorded by Berk. */
  | 'external_contact';

export interface CompanyHistoryEntry {
  id: string;
  type: CompanyHistoryType;
  description: string;
  createdAt: string;
  author: string;
}

export type CompanySource =
  | 'manual'
  | 'research'
  | 'referral'
  | 'google_maps'
  | 'linkedin'
  | 'instagram'
  | 'inbound'
  | 'event';

export const COMPANY_SOURCES: Record<CompanySource, string> = {
  manual: 'Manuel',
  research: 'Araştırma',
  referral: 'Referans',
  google_maps: 'Google Haritalar',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  inbound: 'Gelen Talep',
  event: 'Etkinlik',
};

export const COMPANY_SOURCE_ORDER = Object.keys(COMPANY_SOURCES) as CompanySource[];

export type CompanySize = '1-10' | '11-50' | '51-200' | '201-500' | '500+';

export const COMPANY_SIZES: Record<CompanySize, string> = {
  '1-10': '1–10 kişi',
  '11-50': '11–50 kişi',
  '51-200': '51–200 kişi',
  '201-500': '201–500 kişi',
  '500+': '500+ kişi',
};

export const COMPANY_SIZE_ORDER = Object.keys(COMPANY_SIZES) as CompanySize[];

/** Compact pointer to the research that produced a company (no raw search data). */
export interface ResearchReference {
  requestId: string;
  requestName: string;
  mode: 'demo' | 'real';
  researchedAt: string;
  /** Up to 5 key source URLs (official site first). */
  sourceUrls: string[];
  /** Same sources with their provenance (inspected by KITE or search evidence). Real research only. */
  sources?: { url: string; title: string; sourceType: EvidenceSourceType }[];
}

export interface NextAction {
  label: string;
  dueAt: string | null;
}

export interface Company {
  id: string;
  name: string;
  /** Bare domain, e.g. "dentglow.com". */
  website: string | null;
  /** Turkish label for catalogue sectors, the typed text for custom sectors. */
  sector: string;
  /** Catalogue sector id (sectorTaxonomy) when the sector is known; null/absent for custom sectors. */
  sectorId?: string | null;
  city: string;
  country: string;
  companySize: CompanySize | null;
  source: CompanySource;
  /** Person responsible at KITE. Null when unassigned. */
  owner: string | null;
  status: SalesStatus;
  /** Overall 0–100 score, entered manually. Null when not scored yet. */
  opportunityScore: number | null;
  opportunities: ServiceOpportunity[];
  contacts: Contact[];
  notes: CompanyNote[];
  history: CompanyHistoryEntry[];
  lastContactAt: string | null;
  nextAction: NextAction | null;
  createdAt: string;
  updatedAt: string;
  /** Set for companies added from Yeni Müşteri Bul. */
  researchRef?: ResearchReference;
}

export const DEFAULT_COUNTRY = 'Türkiye';

/**
 * Company-level email/phone (info@, the switchboard) is stored as one contact with this name, the
 * same convention research transfer uses for contact details published on a website. It keeps a
 * single contact model (no duplicated email/phone columns) and is never treated as a person.
 */
export const GENERAL_CONTACT_NAME = 'Genel iletişim';
export const GENERAL_CONTACT_ROLE = 'Şirketin genel iletişim bilgisi';

export function isGeneralContact(c: Pick<Contact, 'fullName'>): boolean {
  return c.fullName.trim().toLocaleLowerCase('tr') === GENERAL_CONTACT_NAME.toLocaleLowerCase('tr');
}

/** First stored person (not the general company contact), if any. */
export function primaryContact(company: Pick<Company, 'contacts'>): Contact | null {
  return company.contacts.find((c) => !isGeneralContact(c)) ?? null;
}

export function generalContact(company: Pick<Company, 'contacts'>): Contact | null {
  return company.contacts.find(isGeneralContact) ?? null;
}

/** People who can own a company. Single-user for now; kept as data so it can come from an API later. */
export const TEAM_MEMBERS = ['Berk Çetinkaya'] as const;

/** Highest-scoring opportunity (unscored ones last), or null if there are none. */
export function primaryOpportunity(company: Pick<Company, 'opportunities'>): ServiceOpportunity | null {
  return sortOpportunities(company.opportunities)[0] ?? null;
}

export function sortOpportunities(opportunities: readonly ServiceOpportunity[]): ServiceOpportunity[] {
  return [...opportunities].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** The signed-in user. Fixed until authentication exists. */
export const CURRENT_USER: string = TEAM_MEMBERS[0];
