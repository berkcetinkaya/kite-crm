// Sales intelligence (Phase 14): deterministic, explainable decision support over existing data.
// Pure: (snapshot, Phase 11 work items, Phase 13 readiness, now) → insights + diagnostics. Nothing is
// stored, no AI, no scores, no forecasts. Recommendations are advisory only: they never send,
// generate, change stages, create records or write the company's own next action.
//
//   Priority  Kritik / Yüksek / Orta / Normal: the highest matching tier wins; every reason is listed.
//   Momentum  Başlamadı / İlerliyor / Bekliyor / Soğuyor / Takıldı (open stages; pre-contact = Başlamadı).
//   Action    one recommended next step (first matching rule), with a link to where it is done.
//   Flags     risk / attention signals, each with a reason.
import {
  COOLING_DAYS,
  CRITICAL_OVERDUE_DAYS,
  daysBetween,
  dayKey,
  DRAFT_APPROVAL_WAITING_DAYS,
  HIGH_POTENTIAL_SCORE,
  LATE_FOLLOW_UP_DAYS,
  MEETING_SOON_DAYS,
  NEW_PROPOSAL_DAYS,
  PROPOSAL_WAITING_DAYS,
  REPLY_RESPONSE_DAYS,
} from './businessDay';
import type { Company } from './company';
import { EXTERNAL_CONTACT_LABELS, latestExternalContact, type ExternalContactChannel } from './externalContact';
import type { Customer } from './customers';
import { isOpenSalesStage, OPEN_SALES_STAGES } from './dashboard';
import { currentStepOf, type FollowUpSequenceView } from './followUp';
import type { MailDraft } from './mail/draft';
import type { OutboundMessage, ThreadMessage } from './outreach';
import { READINESS_LABELS, type Readiness, type ReadinessState } from './outreachReadiness';
import { ACTIVITY_LABELS, buildActivityIndex, companyActivity, daysSince, type ActivityKind } from './salesActivity';
import type { Meeting, Proposal } from './sales';
import { SALES_STAGES, SALES_STATUS, type SalesStatus } from './salesStatus';
import type { WorkItem } from './work';
import { compareTr } from '../lib/text';
import { formatShortDate } from '../lib/date';

// ---------- Vocabulary ----------

export const PRIORITY_LEVELS = ['critical', 'high', 'medium', 'normal'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];
export const PRIORITY_LEVEL_LABELS: Record<PriorityLevel, string> = { critical: 'Kritik', high: 'Yüksek', medium: 'Orta', normal: 'Normal' };
/** Sales priority is always shown with its prefix, so it never reads like Phase 12's "Yüksek Potansiyel". */
export const priorityText = (level: PriorityLevel) => `Öncelik: ${PRIORITY_LEVEL_LABELS[level]}`;

export const MOMENTUM_STATES = ['not_started', 'progressing', 'waiting', 'cooling', 'stuck'] as const;
export type MomentumState = (typeof MOMENTUM_STATES)[number];
export const MOMENTUM_LABELS: Record<MomentumState, string> = { not_started: 'Başlamadı', progressing: 'İlerliyor', waiting: 'Bekliyor', cooling: 'Soğuyor', stuck: 'Takıldı' };

export const PROPOSAL_STATES = ['preparing', 'new', 'deciding', 'follow_up', 'expired', 'accepted', 'rejected'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];
export const PROPOSAL_STATE_LABELS: Record<ProposalState, string> = {
  preparing: 'Hazırlanıyor',
  new: 'Yeni gönderildi',
  deciding: 'Karar bekliyor',
  follow_up: 'Takip zamanı',
  expired: 'Süresi doldu',
  accepted: 'Kabul edildi',
  rejected: 'Reddedildi',
};

export const FLAG_KEYS = [
  'reply_no_action',
  'proposal_waiting',
  'proposal_expired',
  'meeting_no_proposal',
  'meeting_no_outcome',
  'follow_up_late',
  'high_potential_not_started',
  'ready_no_draft',
  'draft_not_approved',
  'approved_not_sent',
  'no_next_action',
  'next_action_overdue',
  'accepted_no_customer',
] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];
export const FLAG_LABELS: Record<FlagKey, string> = {
  reply_no_action: 'Yanıt var, aksiyon yok',
  proposal_waiting: 'Teklif bekliyor',
  proposal_expired: 'Teklif süresi doldu',
  meeting_no_proposal: 'Görüşme yapıldı, teklif yok',
  meeting_no_outcome: 'Görüşme sonucu girilmedi',
  follow_up_late: 'İlk temas sonrası takip gecikti',
  high_potential_not_started: 'Yüksek potansiyel ama iletişim başlamadı',
  ready_no_draft: 'Hazır ama taslak yok',
  draft_not_approved: 'Taslak var ama onaylanmadı',
  approved_not_sent: 'Onaylı taslak gönderilmedi',
  no_next_action: 'Sonraki adım yok',
  next_action_overdue: 'Sonraki adım gecikti',
  accepted_no_customer: 'Teklif kabul edildi, müşteri yok',
};

/** Where an action is done (the browser turns it into a route or opens the company drawer). */
export type SalesLink =
  | { type: 'company'; companyId: string; section?: 'meetings' | 'proposals' | 'contacts' }
  | { type: 'mail'; companyId: string }
  | { type: 'proposal'; proposalId: string };

export type ActionKey =
  | 'convert_customer'
  | 'meeting_outcome'
  | 'answer_reply'
  | 'proposal_expired'
  | 'proposal_follow_up'
  | 'proposal_finish'
  | 'proposal_create'
  | 'meeting_plan'
  | 'follow_up_prepare'
  | 'follow_up_review'
  | 'await_reply'
  | 'send_first_contact'
  | 'review_draft'
  | 'prepare_draft'
  | 'add_contact'
  | 'choose_service'
  | 'choose_angle'
  | 'review_readiness'
  | 'set_next_action';

export interface RecommendedAction {
  key: ActionKey;
  /** "Önerilen: …" */
  label: string;
  /** Why this step (one line). */
  detail: string | null;
  link: SalesLink;
}

export interface ProposalInfo {
  proposalId: string;
  title: string;
  state: ProposalState;
  /** Days since sent (sent proposals), null otherwise. */
  days: number | null;
}

export interface SalesInsight {
  companyId: string;
  companyName: string;
  stage: SalesStatus;
  owner: string | null;
  /** Customers, won, lost, rejected, not-fit and active-customer companies get no sales intelligence. */
  excluded: string | null;
  priority: { level: PriorityLevel; reasons: string[] } | null;
  momentum: { state: MomentumState; reasons: string[] } | null;
  action: RecommendedAction | null;
  /** The user's own next action, never changed by the recommendation. */
  planned: { label: string; dueAt: string | null } | null;
  flags: { key: FlagKey; label: string; reason: string }[];
  stageEnteredAt: string | null;
  daysInStage: number | null;
  lastActivity: { at: string; kind: ActivityKind; label: string; days: number } | null;
  proposal: ProposalInfo | null;
  /** Phase 13 readiness (pre-contact companies), for context. */
  readiness: { state: ReadinessState; label: string } | null;
  highPotential: boolean;
  /** Latest recorded contact outside KITE ("Son harici temas"), shown as manual activity. */
  lastExternalContact: { at: string; channel: ExternalContactChannel; label: string; note: string | null } | null;
}

export interface PipelineDiagnostics {
  openByStage: Record<(typeof OPEN_SALES_STAGES)[number], number>;
  stuck: number;
  cooling: number;
  noNextAction: number;
  noRecentActivity: number;
  proposalsWaiting: number;
  repliesWithoutMeeting: number;
  meetingsWithoutProposal: number;
  readyWithoutDraft: number;
}

export interface SalesIntelligence {
  now: string;
  /** Ranked, excluded companies left out. */
  insights: SalesInsight[];
  diagnostics: PipelineDiagnostics;
}

export interface SalesSnapshot {
  companies: Company[];
  sends: OutboundMessage[];
  messages: ThreadMessage[];
  followUps: FollowUpSequenceView[];
  meetings: Meeting[];
  proposals: Proposal[];
  customers: Pick<Customer, 'companyId' | 'status'>[];
  /** First contact drafts. */
  drafts: MailDraft[];
}

export interface IntelligenceInput {
  snapshot: SalesSnapshot;
  /** Phase 11 work items over the same snapshot (next actions, meetings, follow ups). */
  workItems: WorkItem[];
  /** Phase 13 readiness per company, computed from the same snapshot. */
  readiness: ReadonlyMap<string, Pick<Readiness, 'state' | 'reasons' | 'progress'>>;
  now: string;
}

const EXCLUDED_STATUSES: readonly SalesStatus[] = ['client', 'lost', 'disqualified', 'not_interested'];
const ACTIVE_CUSTOMER: readonly Customer['status'][] = ['onboarding', 'active', 'on_hold'];
const short = (iso: string) => formatShortDate(new Date(iso));

// ---------- Proposal states ----------

export function proposalState(p: Pick<Proposal, 'status' | 'sentAt' | 'validUntil'>, now: string): ProposalState {
  switch (p.status) {
    case 'draft':
    case 'ready':
      return 'preparing';
    case 'accepted':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    case 'expired':
      return 'expired';
    case 'sent': {
      if (p.validUntil && dayKey(p.validUntil) < dayKey(now)) return 'expired';
      const days = daysSince(p.sentAt, now) ?? 0;
      return days < NEW_PROPOSAL_DAYS ? 'new' : days < PROPOSAL_WAITING_DAYS ? 'deciding' : 'follow_up';
    }
  }
}

/** The proposal that matters now: an open one (sent first, then in preparation), else the latest decided. */
function relevantProposal(list: Proposal[]): Proposal | null {
  const by = (s: Proposal['status'][]) => list.filter((p) => s.includes(p.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return by(['sent']) ?? by(['draft', 'ready']) ?? by(['accepted']) ?? [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

// ---------- One company ----------

function highPotentialOf(c: Company): boolean {
  return c.opportunities.some((o) => o.potential === 'high' || (o.score ?? 0) >= HIGH_POTENTIAL_SCORE) || (c.opportunityScore ?? 0) >= HIGH_POTENTIAL_SCORE;
}

function insightFor(c: Company, ctx: Ctx): SalesInsight {
  const now = ctx.now;
  const act = companyActivity(c, ctx.activity, now);
  const base: SalesInsight = {
    companyId: c.id,
    companyName: c.name,
    stage: c.status,
    owner: c.owner,
    excluded: null,
    priority: null,
    momentum: null,
    action: null,
    planned: c.nextAction ? { label: c.nextAction.label, dueAt: c.nextAction.dueAt } : null,
    flags: [],
    stageEnteredAt: act.stageEnteredAt,
    daysInStage: act.daysInStage,
    lastActivity: act.lastActivityAt && act.lastActivityKind ? { at: act.lastActivityAt, kind: act.lastActivityKind, label: ACTIVITY_LABELS[act.lastActivityKind], days: act.daysSinceActivity ?? 0 } : null,
    proposal: null,
    readiness: null,
    highPotential: highPotentialOf(c),
    lastExternalContact: (() => {
      const e = latestExternalContact(c);
      return e ? { ...e, label: EXTERNAL_CONTACT_LABELS[e.channel] } : null;
    })(),
  };
  const customer = ctx.customers.get(c.id);
  if (EXCLUDED_STATUSES.includes(c.status)) return { ...base, excluded: `${SALES_STATUS[c.status].label}: satış önerisi yok.` };
  if (customer && ACTIVE_CUSTOMER.includes(customer.status)) return { ...base, excluded: 'Aktif müşteri: satış önerisi yok.' };

  const open = isOpenSalesStage(c.status);
  const preContact = c.status === 'found' || c.status === 'researched';
  const work = ctx.work.get(c.id) ?? [];
  const has = (kind: WorkItem['kind']) => work.find((w) => w.kind === kind);
  const proposals = ctx.proposals.get(c.id) ?? [];
  const meetings = ctx.meetings.get(c.id) ?? [];
  const followUps = ctx.followUps.get(c.id) ?? [];
  const draft = ctx.drafts.get(c.id) ?? null;
  const readiness = ctx.readiness.get(c.id) ?? null;
  const sent = ctx.sentFirstContact.has(c.id);

  // ----- Signals -----
  const unansweredDays = act.lastReplyAt && (!act.lastResponseAt || act.lastResponseAt < act.lastReplyAt) ? daysSince(act.lastReplyAt, now) : null;
  const replyDays = daysSince(act.lastReplyAt, now);
  const futureMeeting = meetings.filter((m) => m.status === 'planned' && m.scheduledAt >= now).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0] ?? null;
  const meetingSoon = futureMeeting && daysBetween(now, futureMeeting.scheduledAt) <= MEETING_SOON_DAYS ? futureMeeting : null;
  const noOutcome = has('meeting_no_outcome');
  const held = meetings.filter((m) => m.status === 'completed').sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0] ?? null;
  const heldNoProposal = held && !proposals.some((p) => p.createdAt >= held.scheduledAt || dayKey(p.createdAt) >= dayKey(held.scheduledAt)) && (daysSince(held.scheduledAt, now) ?? 0) >= 1 ? held : null;
  const relevant = relevantProposal(proposals);
  const pState = relevant ? proposalState(relevant, now) : null;
  const sentOpen = proposals.filter((p) => p.status === 'sent');
  const expiredSent = sentOpen.find((p) => proposalState(p, now) === 'expired') ?? null;
  const waitingSent = sentOpen.filter((p) => proposalState(p, now) === 'follow_up').sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))[0] ?? null;
  const preparing = proposals.filter((p) => p.status === 'draft' || p.status === 'ready').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  const accepted = proposals.find((p) => p.status === 'accepted') ?? null;
  const acceptedNoCustomer = accepted && !customer ? accepted : null;
  const nextOverdue = has('next_action_overdue');
  const nextToday = has('next_action_today');
  const fuDue = has('follow_up_due');
  const fuBlocked = has('follow_up_blocked');
  const fuUpcoming = followUps.find((s) => s.queueGroup === 'upcoming') ?? null;
  const draftAge = draft ? daysSince(draft.updatedAt, now) ?? 0 : 0;
  const approvedNotSent = draft?.status === 'approved' && !sent ? draft : null;
  const draftPending = draft && draft.status !== 'approved' && !sent ? draft : null;
  const readyNoDraft = preContact && readiness?.state === 'ready' && !draft && !sent;
  const noNext = open && !c.nextAction;

  // ----- Momentum (open stages) -----
  let momentum: SalesInsight['momentum'] = null;
  if (preContact) momentum = { state: 'not_started', reasons: ['İlk temas henüz gönderilmedi.'] };
  else if (open) {
    const stuck: string[] = [];
    if (act.stalled) stuck.push(`${act.daysInStage} gündür bu aşamada ve ${act.daysSinceActivity} gündür hareket yok.`);
    if (expiredSent) stuck.push(`“${expiredSent.title}” teklifinin geçerlilik tarihi geçti.`);
    const cooling: string[] = [];
    if (unansweredDays !== null && unansweredDays >= REPLY_RESPONSE_DAYS) cooling.push(`Yanıta ${unansweredDays} gündür dönülmedi.`);
    if (fuDue && (fuDue.ageDays ?? 0) >= LATE_FOLLOW_UP_DAYS) cooling.push(`Takip maili ${fuDue.ageDays} gündür bekliyor.`);
    if (waitingSent) cooling.push(`“${waitingSent.title}” ${daysSince(waitingSent.sentAt, now)} gündür karar bekliyor.`);
    if (noOutcome) cooling.push('Görüşme sonucu girilmedi.');
    if (!futureMeeting && (act.daysSinceActivity ?? 0) >= COOLING_DAYS) cooling.push(`${act.daysSinceActivity} gündür anlamlı bir hareket yok.`);
    const forwardDays = daysSince(act.lastForwardAt, now);
    if (stuck.length) momentum = { state: 'stuck', reasons: stuck };
    else if (cooling.length) momentum = { state: 'cooling', reasons: cooling };
    else if (futureMeeting) momentum = { state: 'progressing', reasons: [`Planlı görüşme: ${short(futureMeeting.scheduledAt)}.`] };
    else if (forwardDays !== null && forwardDays < COOLING_DAYS) momentum = { state: 'progressing', reasons: [`Son ilerleme ${forwardDays === 0 ? 'bugün' : `${forwardDays} gün önce`}.`] };
    else momentum = { state: 'waiting', reasons: ['Karşı taraftan dönüş bekleniyor.'] };
  }

  // ----- Flags -----
  const flags: SalesInsight['flags'] = [];
  const flag = (key: FlagKey, reason: string) => flags.push({ key, label: FLAG_LABELS[key], reason });
  if (unansweredDays !== null) flag('reply_no_action', unansweredDays === 0 ? 'Bugün yanıt geldi, henüz dönülmedi.' : `${unansweredDays} gündür yanıta dönülmedi.`);
  if (waitingSent) flag('proposal_waiting', `“${waitingSent.title}” ${daysSince(waitingSent.sentAt, now)} gündür karar bekliyor.`);
  if (expiredSent) flag('proposal_expired', `“${expiredSent.title}” geçerlilik tarihi ${expiredSent.validUntil ? short(expiredSent.validUntil) : ''} geçti.`);
  if (heldNoProposal) flag('meeting_no_proposal', `${short(heldNoProposal.scheduledAt)} görüşmesinden sonra teklif hazırlanmadı.`);
  if (noOutcome) flag('meeting_no_outcome', noOutcome.description);
  if (fuDue && (fuDue.ageDays ?? 0) >= 1) flag('follow_up_late', `${fuDue.title} (${fuDue.ageDays} gün).`);
  if (preContact && base.highPotential && !sent) flag('high_potential_not_started', 'Yüksek potansiyelli fırsat, ilk temas gönderilmedi.');
  if (readyNoDraft) flag('ready_no_draft', 'Outreach hazır, taslak hazırlanmadı.');
  if (draftPending && draftAge >= DRAFT_APPROVAL_WAITING_DAYS) flag('draft_not_approved', `Taslak ${draftAge} gündür onay bekliyor.`);
  if (approvedNotSent) flag('approved_not_sent', 'Onaylı ilk temas taslağı gönderilmedi.');
  if (noNext) flag('no_next_action', 'Bu açık fırsat için sonraki adım belirlenmedi.');
  if (nextOverdue) flag('next_action_overdue', `“${nextOverdue.title}” ${nextOverdue.ageDays} gün gecikti.`);
  if (acceptedNoCustomer) flag('accepted_no_customer', `“${acceptedNoCustomer.title}” kabul edildi; müşteri kaydı başlatılmadı.`);

  // ----- Priority (highest tier wins, every reason listed) -----
  const critical: string[] = [];
  const high: string[] = [];
  const medium: string[] = [];
  if (unansweredDays !== null && unansweredDays >= 1) critical.push(`Yanıt geldi, ${unansweredDays} gündür dönüş yapılmadı`);
  if (expiredSent) critical.push(`“${expiredSent.title}” teklifinin geçerlilik tarihi geçti`);
  if (noOutcome) critical.push('Görüşme sonucu girilmedi');
  if (acceptedNoCustomer) critical.push('Teklif kabul edildi, müşteri kaydı yok');
  if (nextOverdue && (nextOverdue.ageDays ?? 0) > CRITICAL_OVERDUE_DAYS) critical.push(`Sonraki adım ${nextOverdue.ageDays} gün gecikti`);
  if (replyDays !== null && replyDays < COOLING_DAYS && !(unansweredDays !== null && unansweredDays >= 1)) high.push(replyDays === 0 ? 'Bugün yanıt geldi' : `Son yanıt ${replyDays} gün önce`);
  if (meetingSoon) high.push(`Görüşme yaklaşıyor: ${short(meetingSoon.scheduledAt)}`);
  if (waitingSent) high.push(`“${waitingSent.title}” ${daysSince(waitingSent.sentAt, now)} gündür karar bekliyor`);
  if (heldNoProposal) high.push('Görüşme yapıldı, teklif yok');
  if (fuDue) high.push(fuDue.title);
  if (fuBlocked) high.push('Takip planı dikkat istiyor');
  if (nextOverdue && (nextOverdue.ageDays ?? 0) <= CRITICAL_OVERDUE_DAYS) high.push(`Sonraki adım ${nextOverdue.ageDays} gün gecikti`);
  if (nextToday) high.push('Sonraki adım bugün');
  if (approvedNotSent) high.push('Onaylı ilk temas taslağı gönderilmedi');
  if (momentum?.state === 'stuck') medium.push('Takıldı');
  if (momentum?.state === 'cooling') medium.push(`Soğuyor: ${momentum.reasons[0]}`);
  if (preContact && base.highPotential && !sent && (readiness?.state === 'ready' || draft)) medium.push('Yüksek potansiyel, iletişim başlamadı');
  if (draftPending && draftAge >= DRAFT_APPROVAL_WAITING_DAYS) medium.push(`Taslak ${draftAge} gündür onay bekliyor`);
  if (noNext) medium.push('Sonraki adım belirlenmedi');
  // Şimdilik Bekle: Berk paused the company on purpose; it stays Normal, signals remain visible as flags.
  const level: PriorityLevel = c.status === 'later' ? 'normal' : critical.length ? 'critical' : high.length ? 'high' : medium.length ? 'medium' : 'normal';
  const reasons = c.status === 'later' ? ['Şimdilik Bekle aşamasında'] : [...critical, ...high, ...medium];
  const priority = { level, reasons: reasons.length ? reasons : ['Acil bir sinyal yok'] };

  // ----- Recommended next action (first match; advisory only) -----
  const company = (section?: 'meetings' | 'proposals' | 'contacts'): SalesLink => ({ type: 'company', companyId: c.id, ...(section ? { section } : {}) });
  const mail: SalesLink = { type: 'mail', companyId: c.id };
  const rec = (key: ActionKey, label: string, link: SalesLink, detail: string | null = null): RecommendedAction => ({ key, label, link, detail });
  let action: RecommendedAction | null = null;
  const missing = readiness?.reasons.filter((r) => r.group === 'missing').map((r) => r.code) ?? [];
  if (c.status === 'later') action = null;
  else if (acceptedNoCustomer) action = rec('convert_customer', 'Müşteriye dönüştür', company(), `“${acceptedNoCustomer.title}” kabul edildi.`);
  else if (noOutcome) action = rec('meeting_outcome', 'Görüşme sonucunu gir', company('meetings'), noOutcome.description);
  else if (unansweredDays !== null) action = rec('answer_reply', 'Yanıta dön', mail, unansweredDays === 0 ? 'Bugün yanıt geldi.' : `${unansweredDays} gündür yanıt bekliyor.`);
  else if (expiredSent) action = rec('proposal_expired', 'Teklifin sonucunu gir veya süresini güncelle', { type: 'proposal', proposalId: expiredSent.id }, `“${expiredSent.title}” geçerlilik tarihi geçti.`);
  else if (waitingSent) action = rec('proposal_follow_up', 'Teklif için takip et', { type: 'proposal', proposalId: waitingSent.id }, `${daysSince(waitingSent.sentAt, now)} gündür karar bekliyor.`);
  else if (preparing) action = rec('proposal_finish', 'Teklifi tamamla ve gönder', { type: 'proposal', proposalId: preparing.id }, `“${preparing.title}” ${preparing.status === 'ready' ? 'gönderilmeye hazır' : 'taslak'}.`);
  else if (heldNoProposal) action = rec('proposal_create', 'Teklif hazırla', company('proposals'), `${short(heldNoProposal.scheduledAt)} görüşmesi yapıldı.`);
  else if (c.status === 'replied' && !futureMeeting && !held) action = rec('meeting_plan', 'Görüşme planla', company('meetings'), 'Yanıt geldi; görüşme planlanmadı.');
  else if (fuDue) action = rec('follow_up_prepare', 'Takip mailini hazırla', mail, fuDue.title);
  else if (fuBlocked) action = rec('follow_up_review', 'Takip planını incele', mail, fuBlocked.description);
  else if (sent && c.status === 'first_contact') action = rec('await_reply', 'Yanıt bekleniyor', mail, fuUpcoming && currentStepOf(fuUpcoming)?.dueAt ? `Sonraki takip: ${short(currentStepOf(fuUpcoming)!.dueAt!)}` : 'İlk temas gönderildi.');
  else if (approvedNotSent) action = rec('send_first_contact', 'İlk teması gönder', mail, 'Taslak onaylandı.');
  else if (draftPending) action = rec('review_draft', 'Taslağı incele ve onayla', mail, null);
  else if (readyNoDraft) action = rec('prepare_draft', 'Taslak hazırla', mail, 'Outreach hazırlığı tamam.');
  else if (preContact && readiness?.state === 'missing' && (missing.includes('no_contact') || missing.includes('contact_invalid'))) action = rec('add_contact', 'Kişi ekle', company('contacts'), 'Geçerli e-postası olan bir kişi yok.');
  else if (preContact && readiness?.state === 'missing' && missing.includes('no_service')) action = rec('choose_service', 'Hizmet seç', mail, 'Hazırlıkta hizmet seçilmedi.');
  else if (preContact && readiness?.state === 'missing') action = rec('choose_angle', 'Açı seç: Genel tanıtım veya araştırma', mail, 'Kanıta dayalı bir açı yok.');
  else if (preContact && (readiness?.state === 'review' || readiness?.state === 'blocked')) action = rec('review_readiness', 'Hazırlıkta incele', mail, readiness.reasons[0]?.message ?? null);
  else if (noNext) action = rec('set_next_action', 'Sonraki adımı belirle', company(), null);

  return {
    ...base,
    priority,
    momentum,
    action,
    flags,
    proposal: relevant && pState ? { proposalId: relevant.id, title: relevant.title, state: pState, days: relevant.status === 'sent' ? daysSince(relevant.sentAt, now) : null } : null,
    readiness: preContact && readiness ? { state: readiness.state, label: READINESS_LABELS[readiness.state] } : null,
  };
}

// ---------- Ranking ----------

const PRIORITY_ORDER: Record<PriorityLevel, number> = { critical: 0, high: 1, medium: 2, normal: 3 };
const MOMENTUM_ORDER: Record<MomentumState, number> = { stuck: 0, cooling: 1, progressing: 2, waiting: 3, not_started: 4 };
const stageRank = (s: SalesStatus) => {
  const i = (SALES_STAGES as readonly string[]).indexOf(s);
  return i >= 0 ? i : -1;
};

/** Priority, momentum, later stage first, longest wait, high potential, name, id. */
export function compareInsights(a: SalesInsight, b: SalesInsight): number {
  return (
    PRIORITY_ORDER[a.priority?.level ?? 'normal'] - PRIORITY_ORDER[b.priority?.level ?? 'normal'] ||
    MOMENTUM_ORDER[a.momentum?.state ?? 'not_started'] - MOMENTUM_ORDER[b.momentum?.state ?? 'not_started'] ||
    stageRank(b.stage) - stageRank(a.stage) ||
    (b.lastActivity?.days ?? b.daysInStage ?? 0) - (a.lastActivity?.days ?? a.daysInStage ?? 0) ||
    Number(b.highPotential) - Number(a.highPotential) ||
    compareTr(a.companyName, b.companyName) ||
    a.companyId.localeCompare(b.companyId)
  );
}

// ---------- Whole pipeline ----------

interface Ctx {
  now: string;
  activity: ReturnType<typeof buildActivityIndex>;
  work: Map<string, WorkItem[]>;
  proposals: Map<string, Proposal[]>;
  meetings: Map<string, Meeting[]>;
  followUps: Map<string, FollowUpSequenceView[]>;
  drafts: Map<string, MailDraft>;
  customers: Map<string, Pick<Customer, 'companyId' | 'status'>>;
  readiness: IntelligenceInput['readiness'];
  sentFirstContact: Set<string>;
}

const groupBy = <T,>(list: readonly T[], key: (t: T) => string | null) => {
  const m = new Map<string, T[]>();
  for (const t of list) {
    const k = key(t);
    if (k) m.set(k, [...(m.get(k) ?? []), t]);
  }
  return m;
};

/** Every company's insight (excluded ones included, marked), unranked. */
export function companyInsights(input: IntelligenceInput): SalesInsight[] {
  const s = input.snapshot;
  const ctx: Ctx = {
    now: input.now,
    activity: buildActivityIndex(s),
    work: groupBy(input.workItems, (w) => w.companyId),
    proposals: groupBy(s.proposals, (p) => p.companyId),
    meetings: groupBy(s.meetings, (m) => m.companyId),
    followUps: groupBy(s.followUps, (f) => f.companyId),
    drafts: new Map(s.drafts.filter((d) => d.kind !== 'follow_up').map((d) => [d.companyId, d])),
    customers: new Map(s.customers.map((c) => [c.companyId, c])),
    readiness: input.readiness,
    sentFirstContact: new Set(s.sends.filter((x) => x.status === 'sent').map((x) => x.companyId)),
  };
  return s.companies.map((c) => insightFor(c, ctx));
}

export function diagnosticsOf(insights: readonly SalesInsight[]): PipelineDiagnostics {
  const live = insights.filter((i) => !i.excluded);
  const openByStage = Object.fromEntries(OPEN_SALES_STAGES.map((s) => [s, 0])) as PipelineDiagnostics['openByStage'];
  for (const i of live) if (i.stage in openByStage) openByStage[i.stage as keyof typeof openByStage] += 1;
  const flagged = (k: FlagKey) => live.filter((i) => i.flags.some((f) => f.key === k)).length;
  return {
    openByStage,
    stuck: live.filter((i) => i.momentum?.state === 'stuck').length,
    cooling: live.filter((i) => i.momentum?.state === 'cooling').length,
    noNextAction: flagged('no_next_action'),
    noRecentActivity: live.filter((i) => isOpenSalesStage(i.stage) && (i.lastActivity?.days ?? 0) >= COOLING_DAYS).length,
    proposalsWaiting: live.filter((i) => i.proposal && ['new', 'deciding', 'follow_up', 'expired'].includes(i.proposal.state) && i.proposal.days !== null).length,
    repliesWithoutMeeting: live.filter((i) => i.action?.key === 'meeting_plan').length,
    meetingsWithoutProposal: flagged('meeting_no_proposal'),
    readyWithoutDraft: flagged('ready_no_draft'),
  };
}

/** Ranked insights (excluded companies left out) and pipeline diagnostics. */
export function salesIntelligence(input: IntelligenceInput): SalesIntelligence {
  const all = companyInsights(input);
  return { now: input.now, insights: all.filter((i) => !i.excluded).sort(compareInsights), diagnostics: diagnosticsOf(all) };
}

/** Ana Sayfa "Öncelikli Fırsatlar": top 5 with a priority above Normal, skipping companies already in Bugün. */
export const FOCUS_LIMIT = 5;
export function focusList(ranked: readonly SalesInsight[], bugunCompanyIds: ReadonlySet<string>): SalesInsight[] {
  return ranked.filter((i) => i.priority && i.priority.level !== 'normal' && !bugunCompanyIds.has(i.companyId)).slice(0, FOCUS_LIMIT);
}
