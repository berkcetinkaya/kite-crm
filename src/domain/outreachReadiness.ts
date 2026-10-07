// Outreach readiness (Phase 13). Computed from stored data on every read and never persisted as
// authoritative state (only a snapshot is kept on each generation). Shared by the server, which is
// the authority (generation gate and the first-contact send guard), and the browser (explanations).
//
// Groups, first match wins:
//   blocked  Gönderime Uygun Değil  a new first contact is operationally forbidden
//   review   İnceleme Gerekli       a human decision is required
//   missing  Eksik Bilgi            information or a preparation choice is missing
//   ready    Hazır                  nothing blocks a draft
//
// Companies created manually or before Phase 12 have no candidate review: the review rules apply
// only when the company is linked to a Phase 12 candidate. Readiness is computed from what exists.
import { foldForSearch } from '../lib/text';
import { websiteHost } from '../lib/url';
import { isValidEmail } from '../lib/email';
import { isGeneralContact, primaryOpportunity, CONTACT_CONFIDENCE_ORDER, type Company, type Contact } from './company';
import type { Customer } from './customers';
import type { FollowUpSequence } from './followUp';
import type { MailDraft } from './mail/draft';
import type { OutboundMessage } from './outreach';
import { countryMatchKey } from './locations';
import { samePhone, type CandidateReview } from './prospecting';
import type { ConfidenceLevel, ResearchResult } from './research';
import { SALES_STATUS, type SalesStatus } from './salesStatus';
import type { ServiceKey } from './services';
import { availableAngles, ctaOptions, DEFAULT_TONE, GENERAL_INTRO, linkedConfidence, type AvailableAngle, type CtaKey, type OutreachTone } from './outreachAngles';
import type { OutreachPreparation } from './outreachPrep';

export const READINESS_STATES = ['blocked', 'review', 'missing', 'ready'] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];
export const READINESS_LABELS: Record<ReadinessState, string> = {
  blocked: 'Gönderime Uygun Değil',
  review: 'İnceleme Gerekli',
  missing: 'Eksik Bilgi',
  ready: 'Hazır',
};

export type ReadinessReasonCode =
  // blocked
  | 'stage_blocked'
  | 'active_customer'
  | 'first_contact_sent'
  | 'follow_up_active'
  | 'research_excluded'
  | 'hard_duplicate'
  // review
  | 'probable_duplicate'
  | 'candidate_not_fit'
  | 'candidate_unreviewed'
  | 'low_confidence'
  | 'status_later'
  | 'send_unclear'
  // missing
  | 'no_contact'
  | 'contact_invalid'
  | 'no_service'
  | 'no_angle'
  | 'angle_unavailable';

export const REASON_GROUP: Record<ReadinessReasonCode, Exclude<ReadinessState, 'ready'>> = {
  stage_blocked: 'blocked',
  active_customer: 'blocked',
  first_contact_sent: 'blocked',
  follow_up_active: 'blocked',
  research_excluded: 'blocked',
  hard_duplicate: 'blocked',
  probable_duplicate: 'review',
  candidate_not_fit: 'review',
  candidate_unreviewed: 'review',
  low_confidence: 'review',
  status_later: 'review',
  send_unclear: 'review',
  no_contact: 'missing',
  contact_invalid: 'missing',
  no_service: 'missing',
  no_angle: 'missing',
  angle_unavailable: 'missing',
};

export interface ReadinessReason {
  code: ReadinessReasonCode;
  group: Exclude<ReadinessState, 'ready'>;
  /** Turkish, for Berk. */
  message: string;
}

/** Stages where a new first contact makes no sense (won, lost, rejected, not a fit). */
export const FIRST_CONTACT_BLOCKED_STATUSES: readonly SalesStatus[] = ['client', 'lost', 'not_interested', 'disqualified'];
const ACTIVE_CUSTOMER: readonly Customer['status'][] = ['onboarding', 'active', 'on_hold'];

// ---------- CRM duplicates ----------

export interface CrmDuplicate {
  key: string;
  level: 'hard' | 'probable';
  kind: 'host' | 'email' | 'name_country' | 'phone';
  companyId: string;
  companyName: string;
  label: string;
  acknowledged: boolean;
}

type DupCompany = Pick<Company, 'id' | 'name' | 'website' | 'country' | 'contacts'>;

/** Exact name match after normalization (case, diacritics, spacing); never fuzzy. */
const nameKey = (name: string) => foldForSearch(name).replace(/\s+/g, ' ').trim();

/**
 * Other CRM companies that may be the same business. The company itself is never compared with
 * itself. Hard: same website host or an exact contact email. Probable: same folded name + country
 * or a matching phone. Names are never fuzzy-matched.
 */
export function crmDuplicates(company: DupCompany, others: readonly DupCompany[], acks: readonly string[] = []): CrmDuplicate[] {
  const ack = new Set(acks);
  const host = websiteHost(company.website);
  const emails = company.contacts.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => !!e);
  const phones = company.contacts.map((c) => c.phone).filter((p): p is string => !!p);
  const name = nameKey(company.name);
  const country = company.country ? countryMatchKey(company.country) : null;
  const out: CrmDuplicate[] = [];
  const add = (d: Omit<CrmDuplicate, 'key' | 'acknowledged'>) => {
    const key = `company:${d.companyId}`;
    const existing = out.find((x) => x.key === key);
    if (existing) {
      if (existing.level === 'probable' && d.level === 'hard') Object.assign(existing, d, { acknowledged: false });
      return;
    }
    out.push({ ...d, key, acknowledged: d.level === 'probable' && ack.has(key) });
  };
  for (const o of others) {
    if (o.id === company.id) continue;
    const base = { companyId: o.id, companyName: o.name };
    if (host && websiteHost(o.website) === host) add({ ...base, level: 'hard', kind: 'host', label: `Aynı website: ${host}` });
    const email = emails.find((e) => o.contacts.some((c) => c.email?.trim().toLowerCase() === e));
    if (email) add({ ...base, level: 'hard', kind: 'email', label: `Aynı e-posta: ${email}` });
    if (name && country && nameKey(o.name) === name && o.country && countryMatchKey(o.country) === country)
      add({ ...base, level: 'probable', kind: 'name_country', label: `Aynı isim ve ülke: ${o.name}` });
    const phone = phones.find((p) => o.contacts.some((c) => samePhone(c.phone, p)));
    if (phone) add({ ...base, level: 'probable', kind: 'phone', label: `Aynı telefon: ${phone}` });
  }
  return out;
}

// ---------- Contacts ----------

export interface RankedContact {
  contact: Contact;
  general: boolean;
  /** Turkish, why it is ranked here. */
  reason: string;
}

/**
 * Contacts with a valid email, best first: a named decision maker, then named contacts by
 * confidence (high → low), then the company's general address. Stored order breaks ties.
 * Nothing is guessed: contacts without a valid email are never offered.
 */
export function rankContacts(company: Pick<Company, 'contacts'>): RankedContact[] {
  const valid = company.contacts.map((c, i) => ({ c, i })).filter(({ c }) => isValidEmail(c.email));
  const rank = (c: Contact) => (isGeneralContact(c) ? 10 : c.isDecisionMaker ? 0 : 1 + CONTACT_CONFIDENCE_ORDER.indexOf(c.confidence));
  return valid
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => ({
      contact: c,
      general: isGeneralContact(c),
      reason: isGeneralContact(c) ? 'genel adres, kişi bilinmiyor' : c.isDecisionMaker ? 'karar verici' : `isimli kişi, güven ${c.confidence === 'high' ? 'Yüksek' : c.confidence === 'medium' ? 'Orta' : 'Düşük'}`,
    }));
}

// ---------- Readiness ----------

export interface LinkedResearch {
  result: ResearchResult;
  /** Phase 12 reviewer decision, when one exists. */
  review: CandidateReview | null;
  /** The result belongs to a Phase 12 discovery run (run details exist), so a review is expected. */
  phase12: boolean;
}

export interface ReadinessInput {
  company: Company;
  /** All CRM companies (the company itself is ignored). */
  companies: readonly Company[];
  customer: Pick<Customer, 'status'> | null;
  /** The company's send attempts (first contact and follow ups). */
  sends: readonly OutboundMessage[];
  followUps: readonly Pick<FollowUpSequence, 'status'>[];
  research: LinkedResearch | null;
  preparation: OutreachPreparation | null;
  /** The company's first contact draft. */
  draft: MailDraft | null;
}

export type OutreachProgress = 'none' | 'draft' | 'draft_approved' | 'sent' | 'replied';
export const PROGRESS_LABELS: Record<OutreachProgress, string> = {
  none: 'Taslak yok',
  draft: 'Taslak var',
  draft_approved: 'Taslak Hazır',
  sent: 'İlk Temas Gönderildi',
  replied: 'Yanıt Geldi',
};

export interface Readiness {
  state: ReadinessState;
  /** Every reason found, blocked first. Empty when ready. */
  reasons: ReadinessReason[];
  contacts: RankedContact[];
  /** Chosen (or best ranked) contact. */
  contact: RankedContact | null;
  service: ServiceKey | null;
  angles: AvailableAngle[];
  /** The angle a draft would use (null for a general introduction or when none exists). */
  angle: AvailableAngle | null;
  general: boolean;
  tone: OutreachTone;
  ctas: CtaKey[];
  cta: CtaKey;
  confidence: ConfidenceLevel | null;
  duplicates: CrmDuplicate[];
  progress: OutreachProgress;
}

const fmtDay = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

export function computeReadiness(input: ReadinessInput): Readiness {
  const { company, preparation: prep } = input;
  const reasons: ReadinessReason[] = [];
  const add = (code: ReadinessReasonCode, message: string) => reasons.push({ code, group: REASON_GROUP[code], message });

  // ---- Gönderime Uygun Değil ----
  if (FIRST_CONTACT_BLOCKED_STATUSES.includes(company.status)) add('stage_blocked', `Şirketin aşaması ${SALES_STATUS[company.status].label}; yeni ilk temas gönderilmez.`);
  if (input.customer && ACTIVE_CUSTOMER.includes(input.customer.status)) add('active_customer', 'Bu şirketle aktif bir müşteri ilişkisi var.');
  const sent = input.sends.filter((s) => s.status === 'sent').sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''));
  if (sent.length) add('first_contact_sent', `İlk temas zaten gönderildi (${fmtDay(sent[0].sentAt ?? sent[0].attemptedAt)}).`);
  if (input.followUps.some((f) => f.status === 'active' || f.status === 'paused')) add('follow_up_active', 'Aktif veya duraklatılmış bir takip planı var.');
  const r = input.research?.result ?? null;
  if (r && (r.researchStatus === 'excluded' || (r.analysis?.exclusionChecks ?? []).some((x) => x.status === 'violated'))) add('research_excluded', 'Araştırmada bu şirket hariç tutma kriterlerine takıldı.');
  const duplicates = crmDuplicates(company, input.companies, prep?.duplicateAcks ?? []);
  for (const d of duplicates.filter((x) => x.level === 'hard')) add('hard_duplicate', `CRM'de aynı şirket olabilir: ${d.companyName} (${d.label}).`);

  // ---- İnceleme Gerekli ----
  for (const d of duplicates.filter((x) => x.level === 'probable' && !x.acknowledged)) add('probable_duplicate', `Muhtemel tekrar: ${d.companyName} (${d.label}). Farklı şirketse onayla.`);
  const linked = input.research;
  // Only for companies that came from a Phase 12 candidate; manual and legacy companies have no review.
  if (linked && (linked.review || linked.phase12)) {
    if (linked.review?.status === 'not_fit') add('candidate_not_fit', 'Aday incelemesinde Uygun Değil olarak işaretlenmiş.');
    else if (linked.review?.status !== 'fit') add('candidate_unreviewed', 'Aday incelemesi Uygun olarak tamamlanmamış.');
  }
  const confidence = r ? linkedConfidence(r) : null;
  if (confidence === 'low') add('low_confidence', 'Araştırma güveni düşük; şirketin doğru eşleştiğini kontrol et.');
  if (company.status === 'later') add('status_later', 'Şirket Şimdilik Bekle aşamasında.');
  if (input.sends.some((s) => s.status === 'ambiguous' || s.status === 'sending')) add('send_unclear', "Önceki bir gönderimin sonucu belirsiz; Gmail'de kontrol et.");

  // ---- Eksik Bilgi ----
  const contacts = rankContacts(company);
  let contact: RankedContact | null = contacts[0] ?? null;
  if (prep?.contactId) {
    const chosen = contacts.find((c) => c.contact.id === prep.contactId) ?? null;
    if (!chosen) add('contact_invalid', 'Seçilen kişi artık yok veya geçerli bir e-posta adresi yok.');
    contact = chosen;
  } else if (!contacts.length) add('no_contact', 'Geçerli e-posta adresi olan bir iletişim kişisi yok.');

  const service = prep?.service ?? primaryOpportunity(company)?.service ?? null;
  if (!service) add('no_service', 'Hizmet seçilmedi ve şirkette kayıtlı bir fırsat yok.');
  const angles = service ? availableAngles(r, service) : [];
  const general = prep?.angleKey === GENERAL_INTRO;
  let angle: AvailableAngle | null = null;
  if (service && !general) {
    if (prep?.angleKey) {
      angle = angles.find((a) => a.key === prep.angleKey) ?? null;
      if (!angle) add('angle_unavailable', 'Seçilen açı artık kanıtla desteklenmiyor; başka bir açı seç.');
    } else {
      angle = angles[0] ?? null;
      if (!angle) add('no_angle', 'Şirkete özel, kanıta dayanan bir açı yok. İstersen açıkça "Genel tanıtım" seçebilirsin.');
    }
  }

  const ctas = service ? ctaOptions(service, general ? null : confidence) : ctaOptions('crm', null);
  const cta = prep?.ctaKey && ctas.includes(prep.ctaKey) ? prep.ctaKey : ctas[0];

  const order: ReadinessState[] = ['blocked', 'review', 'missing'];
  reasons.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const state: ReadinessState = reasons[0]?.group ?? 'ready';

  const draft = input.draft;
  const progress: OutreachProgress =
    company.status === 'replied' ? 'replied' : sent.length ? 'sent' : draft?.status === 'approved' ? 'draft_approved' : draft ? 'draft' : 'none';

  return { state, reasons, contacts, contact, service, angles, angle, general, tone: prep?.tone ?? DEFAULT_TONE, ctas, cta, confidence, duplicates, progress };
}

/** Reasons that refuse a NEW first-contact send (the send guard); empty when sending is allowed. */
export const firstContactSendBlockers = (r: Pick<Readiness, 'reasons'>) => r.reasons.filter((x) => x.group === 'blocked');
