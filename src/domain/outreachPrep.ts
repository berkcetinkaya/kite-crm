// Outreach preparation (Phase 13): the per-company choices and generation metadata behind a first
// contact draft. The draft text itself stays in mail_drafts (authoritative), earlier text in the
// draft version history; this record only says how the draft was prepared and what it rests on.
import type { ServiceKey } from './services';
import type { MailLanguage } from './mail/draft';
import type { ClaimSource, CtaKey, ManualFact, OutreachTone } from './outreachAngles';
import type { Readiness, ReadinessReasonCode, ReadinessState } from './outreachReadiness';
import type { MailDraft } from './mail/draft';
import type { SalesStatus } from './salesStatus';

export const SECTION_KEYS = ['opening', 'observation', 'value', 'cta'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_LABELS: Record<SectionKey, string> = { opening: 'Giriş', observation: 'Gözlem', value: 'Değer', cta: 'Kapanış çağrısı' };

/** A generated body section with the hash used to detect manual edits. */
export interface DraftSection {
  key: SectionKey;
  text: string;
  hash: string;
}

export interface ClaimMapEntry {
  sentence: string;
  sourceIds: string[];
}

/** An alternative draft from the same generation (at most 2). */
export interface DraftVariant {
  id: string;
  label: string;
  angleKey: string;
  tone: OutreachTone;
  subjectOptions: string[];
  body: string;
  sections: DraftSection[];
  claims: ClaimMapEntry[];
}

export interface ContactSnapshot {
  contactId: string;
  fullName: string;
  role: string;
  email: string;
  general: boolean;
}

export interface ReadinessSnapshot {
  state: ReadinessState;
  reasons: ReadinessReasonCode[];
  at: string;
}

export interface OutreachPreparation {
  companyId: string;
  draftId: string | null;
  contactId: string | null;
  contactSnapshot: ContactSnapshot | null;
  service: ServiceKey | null;
  angleKey: string | null;
  tone: OutreachTone;
  ctaKey: CtaKey | null;
  language: MailLanguage | null;
  manualFacts: ManualFact[];
  /** "Farklı şirket" confirmations for probable CRM duplicates ("company:<id>"). */
  duplicateAcks: string[];
  claimSources: ClaimSource[];
  claims: ClaimMapEntry[];
  sections: DraftSection[];
  /** Subject options of the last generation (to tell a manually typed subject apart). */
  subjectOptions: string[];
  variants: DraftVariant[];
  readinessSnapshot: ReadinessSnapshot | null;
  promptVersion: string | null;
  provider: 'anthropic' | 'fixture' | null;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const emptyPreparation = (companyId: string, at: string): OutreachPreparation => ({
  companyId,
  draftId: null,
  contactId: null,
  contactSnapshot: null,
  service: null,
  angleKey: null,
  tone: 'premium',
  ctaKey: null,
  language: null,
  manualFacts: [],
  duplicateAcks: [],
  claimSources: [],
  claims: [],
  sections: [],
  subjectOptions: [],
  variants: [],
  readinessSnapshot: null,
  promptVersion: null,
  provider: null,
  generatedAt: null,
  createdAt: at,
  updatedAt: at,
});

export const MAX_BATCH_PREPARE = 5;
export const DEFAULT_MAX_REAL_GENERATIONS_PER_DAY = 30;

export type GenerateMode = 'full' | 'subject' | 'opening' | 'cta';
export const GENERATE_MODE_LABELS: Record<GenerateMode, string> = { full: 'Tüm taslak', subject: 'Yalnızca konu', opening: 'Yalnızca giriş', cta: 'Yalnızca kapanış' };

export type OutreachPrepErrorCode = 'not_found' | 'not_ready' | 'edits_present' | 'section_edited' | 'no_draft' | 'daily_limit' | 'invalid_request' | 'batch_too_large' | 'not_configured';

export const OUTREACH_PREP_ERROR_MESSAGES: Record<OutreachPrepErrorCode, string> = {
  not_found: 'Şirket bulunamadı.',
  not_ready: 'Bu şirket henüz taslak için hazır değil. Hazırlık sekmesindeki eksikleri tamamla.',
  edits_present: 'Taslakta senin düzenlemelerin var. Üzerine yazmak için açıkça onay ver; mevcut metin önceki sürümlere kaydedilir.',
  section_edited: 'Bu bölümü elle düzenlemişsin; yalnızca bu bölüm yeniden yazılamaz. Tüm taslağı düzenlemelerinin yerine yazarak yeniden oluşturabilirsin.',
  no_draft: 'Önce tam bir taslak hazırla.',
  daily_limit: 'Bugünkü gerçek taslak üretim sınırına ulaşıldı. Yarın tekrar dene.',
  invalid_request: 'Gönderilen bilgiler geçersiz.',
  batch_too_large: `Toplu hazırlık en fazla ${MAX_BATCH_PREPARE} şirket içindir.`,
  not_configured: 'Mail taslağı üretmek için Anthropic API bağlantısı yapılandırılmalı.',
};

/** Fields Berk can set in Hazırlık. Null leaves the stored value; contactId null clears the choice. */
export interface PreparationPatch {
  contactId?: string | null;
  service?: ServiceKey | null;
  angleKey?: string | null;
  tone?: OutreachTone;
  ctaKey?: CtaKey | null;
  language?: MailLanguage | null;
  manualFacts?: ManualFact[];
  duplicateAcks?: string[];
}

export type BatchItemStatus = 'generated' | 'skipped' | 'failed';
export interface BatchItemResult {
  companyId: string;
  companyName: string;
  status: BatchItemStatus;
  /** Turkish reason for skipped / failed. */
  message: string | null;
}

/** Stable text fingerprint for edit detection (FNV-1a, 2×32 bit). Not a security hash. */
export function sectionHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export const makeSection = (key: SectionKey, text: string): DraftSection => ({ key, text, hash: sectionHash(text) });

/** True when the generated section text is still present, unchanged, in the current body. */
export const sectionIntact = (s: DraftSection, body: string) => !s.text.trim() || (sectionHash(s.text) === s.hash && body.includes(s.text));

// ---------- API views ----------

export interface PreparationOverviewItem {
  companyId: string;
  companyName: string;
  status: SalesStatus;
  readiness: Pick<Readiness, 'state' | 'reasons' | 'progress' | 'service' | 'general'> & { angleLabel: string | null; contactName: string | null; contactEmail: string | null };
  draftId: string | null;
}

export interface PreparationDetail {
  companyId: string;
  readiness: Readiness;
  preparation: OutreachPreparation | null;
  draft: MailDraft | null;
  /** Research evidence ids → URL / title, for "Bu cümle neye dayanıyor?". */
  evidence: { id: string; url: string; title: string }[];
  realGenerations: { today: number; limit: number };
}
