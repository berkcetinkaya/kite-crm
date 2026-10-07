// Prospecting (Phase 12): the review layer on top of Phase 4 research. A research job is a discovery
// run, a research result is a candidate outside the CRM; this module adds structured run filters,
// reviewer decisions, live duplicate detection, categorical research confidence, prospect priority
// with explicit reasons and the sector gate. Shared by the server (authority) and the browser.
//
// Rules: human-reviewed only (no automatic CRM insertion, no outreach); nothing guessed is shown as
// fact (observed / inferred / unknown stay distinct); no numeric confidence in the UI.
import { foldForSearch } from '../lib/text';
import { websiteHost } from '../lib/url';
import type { Company, CompanySize } from './company';
import type { ResearchRequest } from './research';
import { countryMatchKey } from './locations';
import { RECOMMEND_MIN_SCORE } from './opportunityAnalysis';
import { isInspectedEvidence, type ConfidenceLevel, type ResearchProviderId, type ResearchResult, type ServiceOpportunityAnalysis, type ServiceSignal } from './research';
import { scoreBand } from './score';
import type { SectorFamilyId } from './sectorTaxonomy';
import { SERVICES, type ServiceKey } from './services';

// ---------- Run filters (explicit; nothing inferred silently) ----------

export const WEBSITE_FILTERS = ['has', 'any', 'none'] as const;
export type WebsiteFilter = (typeof WEBSITE_FILTERS)[number];
export const WEBSITE_FILTER_LABELS: Record<WebsiteFilter, string> = { has: 'Websitesi olanlar', any: 'Fark etmez', none: 'Websitesi olmayanlar' };

export const LANGUAGE_FILTERS = ['any', 'tr', 'en'] as const;
export type LanguageFilter = (typeof LANGUAGE_FILTERS)[number];
export const LANGUAGE_FILTER_LABELS: Record<LanguageFilter, string> = { any: 'Fark etmez', tr: 'Türkçe', en: 'İngilizce' };

export type SizeFilter = 'any' | CompanySize;

export interface DiscoveryFilters {
  /** Sector family; the sub-sector is the run's sector id (catalogue sector). */
  familyId: SectorFamilyId | null;
  website: WebsiteFilter;
  /** Only companies with a public contact channel are a fit (checked after inspection). */
  contactRequired: boolean;
  language: LanguageFilter;
  size: SizeFilter;
}

/** Defaults keep Phase 4 behaviour: an official website is required. */
export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = { familyId: null, website: 'has', contactRequired: false, language: 'any', size: 'any' };

/** Run details (1:1 with a research job): structured filters and what actually ran. */
export interface DiscoveryRunDetails {
  jobId: string;
  /** The provider the server actually used (fixture runs never count against the real-run cap). */
  provider: ResearchProviderId;
  filters: DiscoveryFilters;
  searchQueries: string[];
  searchesUsed: number;
  plannedMaxSearches: number;
  plannedMaxInspections: number;
  createdAt: string;
  updatedAt: string;
}

// ---------- Review ----------

/** "CRM'e Eklendi" is not stored: it is derived from the result's transferred company link. */
export const REVIEW_STATUSES = ['unreviewed', 'fit', 'not_fit'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = { unreviewed: 'İncelenmedi', fit: 'Uygun', not_fit: 'Uygun Değil' };
export const CONVERTED_LABEL = "CRM'e Eklendi";

export const CONTACT_PROVENANCES = ['website', 'search_result', 'manual'] as const;
export type ContactProvenance = (typeof CONTACT_PROVENANCES)[number];
export const CONTACT_PROVENANCE_LABELS: Record<ContactProvenance, string> = { website: 'Website', search_result: 'Arama sonucu', manual: 'Manuel' };

/** A contact the reviewer will carry into the CRM. Never guessed: found on a page or typed manually. */
export interface CandidateContact {
  fullName: string;
  role: string;
  email: string | null;
  phone: string | null;
  provenance: ContactProvenance;
  evidenceIds: string[];
}

export interface CandidateReview {
  resultId: string;
  status: ReviewStatus;
  /** Required while Uygun Değil; the last reason is kept if the decision is reversed. */
  rejectReason: string | null;
  notes: string;
  /** Reviewer overrides (null = keep the research value). */
  sector: string | null;
  sectorId: string | null;
  /** Explicitly chosen services, primary first (null = not chosen yet; conversion then uses the pre-ticked defaults the reviewer saw). */
  services: ServiceKey[] | null;
  /** Final contact list (null = default from the research contact hints). */
  contacts: CandidateContact[] | null;
  /** "Farklı şirket" confirmations: keys of probable matches, e.g. "company:cmp_…", "result:res_…". */
  duplicateAcks: string[];
  reviewedAt: string | null;
  updatedAt: string;
}

export const emptyReview = (resultId: string, at: string): CandidateReview => ({
  resultId,
  status: 'unreviewed',
  rejectReason: null,
  notes: '',
  sector: null,
  sectorId: null,
  services: null,
  contacts: null,
  duplicateAcks: [],
  reviewedAt: null,
  updatedAt: at,
});

/** Re-research keeps the previous research snapshots (latest 3). */
export const MAX_RESEARCH_VERSIONS = 3;

export interface ResearchVersion {
  id: string;
  resultId: string;
  version: number;
  /** The research snapshot that was replaced (Phase 4 snapshot keys + top-level research fields). */
  snapshot: Record<string, unknown>;
  opportunityScore: number | null;
  createdAt: string;
}

/** Default real research runs per day (server-configurable). Fixture runs are not counted. */
export const DEFAULT_MAX_REAL_RUNS_PER_DAY = 10;

export type ProspectingErrorCode =
  | 'candidate_not_found'
  | 'candidate_converted'
  | 'candidate_invalid'
  | 'candidate_reason_required'
  | 'candidate_duplicate'
  | 'candidate_confirmation_required'
  | 'candidate_not_convertible'
  | 'candidate_busy'
  | 'candidate_rejected'
  | 'daily_limit'
  | 'job_not_found';

export const PROSPECTING_ERROR_MESSAGES: Record<ProspectingErrorCode, string> = {
  candidate_not_found: 'Aday bulunamadı.',
  candidate_converted: "Bu aday zaten CRM'e eklendi; değişiklikler şirket kartından yapılır.",
  candidate_invalid: 'Aday bilgileri geçersiz.',
  candidate_reason_required: '“Uygun Değil” için bir neden yaz.',
  candidate_duplicate: "Bu şirket CRM'de zaten var; ikinci kayıt oluşturulmaz.",
  candidate_confirmation_required: 'Muhtemel tekrar var. Önce “Farklı şirket” olarak onayla.',
  candidate_not_convertible: "Bu aday CRM'e eklenemez (analiz tamamlanmadı, başarısız oldu veya hariç tutma kriteriyle eşleşti).",
  candidate_busy: 'Bu aday için başka bir işlem sürüyor. Lütfen bekle.',
  candidate_rejected: "“Uygun Değil” olarak işaretli; CRM'e eklemek için önce kararı değiştir.",
  daily_limit: 'Bugünkü gerçek araştırma sınırına ulaşıldı. Yarın tekrar dene ya da sınırı sunucu ayarından değiştir.',
  job_not_found: 'Araştırma bulunamadı.',
};

// =====================================================================================
// Live duplicate detection (never stored: companies and other runs change)
// =====================================================================================

export type DuplicateLevel = 'hard' | 'probable' | 'info';
export type DuplicateKind = 'host' | 'email' | 'converted_host' | 'name_country' | 'phone' | 'other_run';
export const DUPLICATE_LEVEL_LABELS: Record<DuplicateLevel, string> = { hard: "CRM'de mevcut", probable: 'Muhtemel tekrar', info: 'Önceki araştırmada var' };

/** Badge text: an informational level that only holds confirmed probable matches reads "Farklı şirket (onaylandı)". */
export function duplicateBadgeLabel(d: Pick<DuplicateCheck, 'level' | 'matches'>): string | null {
  if (!d.level) return null;
  if (d.level === 'info' && !d.matches.some((m) => m.kind === 'other_run')) return 'Farklı şirket (onaylandı)';
  return DUPLICATE_LEVEL_LABELS[d.level];
}

export interface DuplicateMatch {
  /** "company:<id>" or "result:<id>"; the key a "Farklı şirket" confirmation refers to. */
  key: string;
  level: DuplicateLevel;
  kind: DuplicateKind;
  /** Turkish explanation, e.g. "Aynı website: aurora-dental.example". */
  label: string;
  companyId: string | null;
  companyName: string | null;
  resultId: string | null;
  jobId: string | null;
  /** Probable match confirmed as a different company. */
  acknowledged: boolean;
}

export interface DuplicateCheck {
  /** Highest level that still matters: hard always; probable only when not confirmed; info otherwise. */
  level: DuplicateLevel | null;
  matches: DuplicateMatch[];
  /** Hard match: conversion is blocked. */
  blocksConversion: boolean;
  /** Unconfirmed probable match: conversion needs "Farklı şirket". */
  needsConfirmation: boolean;
}

type CompanyLike = Pick<Company, 'id' | 'name' | 'website' | 'country' | 'contacts'>;
type ResultLike = Pick<ResearchResult, 'id' | 'researchRequestId' | 'companyName' | 'website' | 'country' | 'transferredCompanyId'>;

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
/** Phones match on their last 9 digits when both have at least 9 (country / trunk prefixes differ). */
const samePhone = (a: string | null | undefined, b: string | null | undefined) => {
  const x = digits(a);
  const y = digits(b);
  return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9);
};

export function candidateDuplicates(
  candidate: ResultLike & { contactHints?: ResearchResult['contactHints'] },
  ctx: { companies: readonly CompanyLike[]; otherResults: readonly ResultLike[]; acks?: readonly string[]; extraEmails?: readonly (string | null)[]; extraPhones?: readonly (string | null)[] },
): DuplicateCheck {
  const acks = new Set(ctx.acks ?? []);
  const matches: DuplicateMatch[] = [];
  const add = (m: Omit<DuplicateMatch, 'acknowledged'>) => {
    // One entry per target; a hard match for the same target replaces a probable one.
    const existing = matches.find((x) => x.key === m.key);
    if (existing) {
      if (existing.level !== 'hard' && m.level === 'hard') Object.assign(existing, m, { acknowledged: false });
      return;
    }
    matches.push({ ...m, acknowledged: m.level === 'probable' && acks.has(m.key) });
  };
  const host = websiteHost(candidate.website);
  const emails = [...(candidate.contactHints ?? []).filter((h) => h.kind === 'email').map((h) => h.value), ...(ctx.extraEmails ?? [])]
    .filter((e): e is string => !!e)
    .map((e) => e.trim().toLowerCase());
  const phones = [...(candidate.contactHints ?? []).filter((h) => h.kind === 'phone').map((h) => h.value), ...(ctx.extraPhones ?? [])].filter((p): p is string => !!p);
  const name = foldForSearch(candidate.companyName.trim());
  const country = candidate.country ? countryMatchKey(candidate.country) : null;

  for (const c of ctx.companies) {
    if (c.id === candidate.transferredCompanyId) continue;
    const base = { key: `company:${c.id}`, companyId: c.id, companyName: c.name, resultId: null, jobId: null };
    if (host && websiteHost(c.website) === host) add({ ...base, level: 'hard', kind: 'host', label: `Aynı website: ${host}` });
    const email = emails.find((e) => c.contacts.some((ct) => ct.email?.trim().toLowerCase() === e));
    if (email) add({ ...base, level: 'hard', kind: 'email', label: `Aynı e-posta: ${email}` });
    if (name && foldForSearch(c.name.trim()) === name && country && c.country && countryMatchKey(c.country) === country)
      add({ ...base, level: 'probable', kind: 'name_country', label: `Aynı isim ve ülke: ${c.name}` });
    const phone = phones.find((p) => c.contacts.some((ct) => samePhone(ct.phone, p)));
    if (phone) add({ ...base, level: 'probable', kind: 'phone', label: `Aynı telefon: ${phone}` });
  }
  if (host) {
    for (const r of ctx.otherResults) {
      if (r.id === candidate.id || websiteHost(r.website) !== host) continue;
      if (r.transferredCompanyId) {
        const company = ctx.companies.find((c) => c.id === r.transferredCompanyId);
        const companyName = company?.name ?? r.companyName;
        add({ key: `company:${r.transferredCompanyId}`, level: 'hard', kind: 'converted_host', label: `Başka bir araştırmadan CRM'e eklendi: ${companyName}`, companyId: r.transferredCompanyId, companyName, resultId: r.id, jobId: r.researchRequestId });
      } else if (r.researchRequestId !== candidate.researchRequestId) {
        add({ key: `result:${r.id}`, level: 'info', kind: 'other_run', label: `Önceki araştırmada da bulundu: ${r.companyName}`, companyId: null, companyName: null, resultId: r.id, jobId: r.researchRequestId });
      }
    }
  }
  const hard = matches.some((m) => m.level === 'hard');
  const openProbable = matches.some((m) => m.level === 'probable' && !m.acknowledged);
  const level: DuplicateLevel | null = hard ? 'hard' : openProbable ? 'probable' : matches.length ? 'info' : null;
  return { level, matches, blocksConversion: hard, needsConfirmation: !hard && openProbable };
}

// =====================================================================================
// Research confidence (categorical; observed / inferred / unknown kept apart)
// =====================================================================================

export interface ResearchConfidence {
  level: ConfidenceLevel;
  reasons: string[];
}

export function researchConfidence(r: Pick<ResearchResult, 'researchStatus' | 'verification' | 'evidence' | 'analysis'>): ResearchConfidence {
  if (r.researchStatus !== 'analyzed' && r.researchStatus !== 'excluded') return { level: 'low', reasons: ['Analiz tamamlanmadı.'] };
  const firstParty = (r.evidence ?? []).filter(isInspectedEvidence).length;
  const inspected = !!r.analysis?.websiteInspected;
  const status = r.verification?.status ?? 'unverified';
  const reasons = [
    status === 'verified' ? 'Kimlik doğrulandı.' : status === 'partial' ? 'Kimlik kısmen doğrulandı.' : 'Kimlik doğrulanamadı.',
    inspected ? `Website incelendi (${firstParty} sayfa).` : 'Website incelenmedi; yalnızca arama sonuçları var.',
  ];
  if (status === 'verified' && inspected && firstParty >= 2) return { level: 'high', reasons };
  if (status === 'verified' || status === 'partial') return { level: 'medium', reasons };
  return { level: 'low', reasons };
}

/** How a signal is known: measured from the site's code, inferred by the model from evidence, or unknown. */
export type SignalKnowledge = 'observed' | 'inferred' | 'unknown';
export const SIGNAL_KNOWLEDGE_LABELS: Record<SignalKnowledge, string> = { observed: 'Gözlenen', inferred: 'Çıkarım', unknown: 'Bilinmiyor' };
export const signalKnowledge = (s: Pick<ServiceSignal, 'origin' | 'state'>): SignalKnowledge =>
  s.state === 'unknown' || s.origin === 'not_inspected' ? 'unknown' : s.origin === 'check' ? 'observed' : 'inferred';

// =====================================================================================
// Sector gate + service recommendations
// =====================================================================================

/**
 * Services never pre-ticked automatically for a sector family. Deliberately small and explicit: it
 * only stops automatic recommendations; the reviewer can still tick any service manually.
 */
export const SECTOR_SERVICE_GATE: Partial<Record<SectorFamilyId, readonly ServiceKey[]>> = {
  energy: ['social_media'],
  manufacturing: ['social_media'],
  wholesale: ['social_media'],
  logistics: ['social_media'],
};

export const isGated = (service: ServiceKey, familyId: SectorFamilyId | null) => !!familyId && (SECTOR_SERVICE_GATE[familyId] ?? []).includes(service);

/** Recommended services after the sector gate: primary / secondary, above the threshold, with at least one positive signal. */
export function recommendedServices(r: Pick<ResearchResult, 'serviceOpportunities'>, familyId: SectorFamilyId | null): ServiceOpportunityAnalysis[] {
  return (r.serviceOpportunities ?? []).filter(
    (o) => o.recommendation !== 'none' && o.score >= RECOMMEND_MIN_SCORE && !isGated(o.service, familyId) && o.signals.some((s) => s.state === 'positive'),
  );
}

/** Services pre-ticked for the reviewer (primary first). The reviewer's explicit choice always wins. */
export const defaultServices = (r: Pick<ResearchResult, 'serviceOpportunities'>, familyId: SectorFamilyId | null): ServiceKey[] => recommendedServices(r, familyId).map((o) => o.service);

// =====================================================================================
// Contactability + priority
// =====================================================================================

export function contactChannels(r: Pick<ResearchResult, 'contactHints' | 'technical'>): string[] {
  const out: string[] = [];
  const hints = r.contactHints ?? [];
  const t = r.technical;
  if (hints.some((h) => h.kind === 'email') || t?.hasEmail) out.push('E-posta');
  if (hints.some((h) => h.kind === 'phone') || t?.hasPhone) out.push('Telefon');
  if (hints.some((h) => h.kind === 'whatsapp') || t?.hasWhatsApp) out.push('WhatsApp');
  if (hints.some((h) => h.kind === 'contact_page') || t?.hasContactPage) out.push('İletişim sayfası');
  if (hints.some((h) => h.kind === 'person')) out.push('İsimli kişi');
  return out;
}

export const PRIORITY_LEVELS = ['high', 'medium', 'low'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];
export const PRIORITY_LABELS: Record<PriorityLevel, string> = { high: 'Yüksek Potansiyel', medium: 'Orta Potansiyel', low: 'Düşük Potansiyel' };

export interface ProspectPriority {
  level: PriorityLevel;
  /** "Neden bu firma?": up to 3 supporting reasons, observed facts first. */
  supporting: string[];
  /** What weakens the case or caps the priority. */
  weakening: string[];
}

type PriorityInput = Pick<ResearchResult, 'researchStatus' | 'verification' | 'evidence' | 'analysis' | 'serviceOpportunities' | 'contactHints' | 'technical' | 'companySize'>;

export function prospectPriority(r: PriorityInput, opts: { filters: DiscoveryFilters | null; familyId: SectorFamilyId | null }): ProspectPriority {
  const weakening: string[] = [];
  const top = recommendedServices(r, opts.familyId)[0] ?? null;
  const supporting = top
    ? [...top.signals]
        .filter((s) => s.state === 'positive')
        .sort((a, b) => Number(signalKnowledge(a) !== 'observed') - Number(signalKnowledge(b) !== 'observed') || b.weight - a.weight)
        .slice(0, 3)
        .map((s) => `${SERVICES[top.service].label}: ${s.label} (${SIGNAL_KNOWLEDGE_LABELS[signalKnowledge(s)]})`)
    : [];
  if (r.researchStatus !== 'analyzed' && r.researchStatus !== 'excluded') return { level: 'low', supporting, weakening: ['Analiz tamamlanmadı; değerlendirme yapılamaz.'] };

  const confidence = researchConfidence(r);
  const channels = contactChannels(r);
  const unverified = (r.verification?.status ?? 'unverified') === 'unverified';
  const excluded = r.researchStatus === 'excluded' || (r.analysis?.exclusionChecks ?? []).some((e) => e.status === 'violated' && e.evidenceIds.length > 0);
  const f = opts.filters;
  if (excluded) weakening.push('Hariç tutma kriterlerinden biriyle eşleşiyor.');
  if (unverified) weakening.push('Şirket kimliği doğrulanamadı.');
  if (channels.length === 0) weakening.push(f?.contactRequired ? 'Herkese açık iletişim kanalı bulunamadı (bu araştırmada zorunlu).' : 'Herkese açık iletişim kanalı bulunamadı.');
  if (!top) weakening.push('Önerilecek kadar güçlü bir hizmet fırsatı bulunamadı.');
  const lang = r.technical?.language?.toLowerCase() ?? null;
  const langMismatch = !!f && f.language !== 'any' && !!lang && !lang.startsWith(f.language);
  if (langMismatch) weakening.push(`Site dili (${lang}) istenen dil değil.`);
  const sizeMismatch = !!f && f.size !== 'any' && !!r.companySize && r.companySize !== f.size;
  if (sizeMismatch) weakening.push(`Şirket büyüklüğü (${r.companySize}) istenen aralık değil.`);
  if (confidence.level === 'low' && !unverified) weakening.push('Araştırma güveni düşük.');

  if (excluded || unverified || (!!f?.contactRequired && channels.length === 0) || !top) return { level: 'low', supporting, weakening };
  const high = scoreBand(top.score) === 'strong' && confidence.level !== 'low' && channels.length > 0 && !langMismatch && !sizeMismatch;
  return { level: high ? 'high' : 'medium', supporting, weakening };
}

// =====================================================================================
// Re-research diff ("Değişenler")
// =====================================================================================

type DiffInput = Pick<ResearchResult, 'opportunityScore' | 'service' | 'serviceOpportunities' | 'verification' | 'contactHints' | 'technical' | 'analysis' | 'researchStatus'>;

export function researchDiff(before: Partial<DiffInput>, after: Partial<DiffInput>): string[] {
  const out: string[] = [];
  if ((before.researchStatus ?? null) !== (after.researchStatus ?? null)) out.push(`Durum: ${before.researchStatus ?? '—'} → ${after.researchStatus ?? '—'}`);
  if ((before.opportunityScore ?? null) !== (after.opportunityScore ?? null)) out.push(`Genel fırsat puanı: ${before.opportunityScore ?? '—'} → ${after.opportunityScore ?? '—'}`);
  if (before.service && after.service && before.service !== after.service) out.push(`Öne çıkan hizmet: ${SERVICES[before.service].label} → ${SERVICES[after.service].label}`);
  const rec = (x: Partial<DiffInput>) => new Set((x.serviceOpportunities ?? []).filter((o) => o.recommendation !== 'none').map((o) => o.service));
  const rb = rec(before);
  const ra = rec(after);
  for (const s of ra) if (!rb.has(s)) out.push(`Yeni önerilen hizmet: ${SERVICES[s].label}`);
  for (const s of rb) if (!ra.has(s)) out.push(`Artık önerilmeyen hizmet: ${SERVICES[s].label}`);
  if ((before.verification?.status ?? null) !== (after.verification?.status ?? null)) out.push(`Doğrulama: ${before.verification?.status ?? '—'} → ${after.verification?.status ?? '—'}`);
  if (!!before.analysis?.websiteInspected !== !!after.analysis?.websiteInspected) out.push(after.analysis?.websiteInspected ? 'Website bu kez incelenebildi.' : 'Website bu kez incelenemedi.');
  const hints = (x: Partial<DiffInput>) => new Set((x.contactHints ?? []).map((h) => `${h.kind}\u0000${h.value}`));
  const hb = hints(before);
  const ha = hints(after);
  for (const h of ha) if (!hb.has(h)) out.push(`Yeni iletişim bilgisi: ${h.split('\u0000')[1]}`);
  for (const h of hb) if (!ha.has(h)) out.push(`Artık bulunmayan iletişim bilgisi: ${h.split('\u0000')[1]}`);
  const states = (x: Partial<DiffInput>) => new Map((x.serviceOpportunities ?? []).flatMap((o) => o.signals.map((s) => [`${o.service}.${s.key}`, s.state] as const)));
  const sb = states(before);
  const changed = [...states(after)].filter(([k, v]) => sb.has(k) && sb.get(k) !== v).length;
  if (changed) out.push(`${changed} sinyalin durumu değişti.`);
  for (const [key, label] of [['https', 'HTTPS'], ['hasViewport', 'Mobil görünüm etiketi'], ['hasMetaDescription', 'Meta açıklama']] as const) {
    const b = before.technical?.[key] ?? null;
    const a = after.technical?.[key] ?? null;
    if (b !== null && a !== null && b !== a) out.push(`${label}: ${b ? 'var' : 'yok'} → ${a ? 'var' : 'yok'}`);
  }
  return out;
}

// =====================================================================================
// API views (server → browser)
// =====================================================================================

export interface CandidateView {
  result: ResearchResult;
  review: CandidateReview;
  convertedCompanyId: string | null;
  convertedCompanyName: string | null;
  duplicates: DuplicateCheck;
  confidence: ResearchConfidence;
  priority: ProspectPriority;
  familyId: SectorFamilyId | null;
  /** Services pre-ticked for the reviewer (after the sector gate). */
  defaultServices: ServiceKey[];
  /** Contacts the research found (never guessed). */
  defaultContacts: CandidateContact[];
  channels: string[];
  versionCount: number;
}

export interface DiscoveryJobView {
  job: ResearchRequest;
  details: DiscoveryRunDetails | null;
  candidates: CandidateView[];
  counts: { total: number; unreviewed: number; fit: number; notFit: number; converted: number };
  /** Every candidate reviewed or converted ("İncelendi"). */
  reviewed: boolean;
}

export interface ReviewPatch {
  status?: ReviewStatus;
  rejectReason?: string | null;
  notes?: string;
  sector?: string | null;
  sectorId?: string | null;
  services?: ServiceKey[] | null;
  contacts?: CandidateContact[] | null;
}

export type BulkAction =
  | { type: 'status'; status: ReviewStatus; rejectReason?: string | null }
  | { type: 'services'; services: ServiceKey[] }
  | { type: 'sector'; sector: string; sectorId: string | null };

export type ConversionStatus = 'converted' | 'already_converted' | 'duplicate' | 'confirmation_required' | 'not_convertible' | 'not_found' | 'error';
export interface ConversionResult {
  resultId: string;
  status: ConversionStatus;
  ok: boolean;
  message: string;
  companyId: string | null;
  companyName: string | null;
}
