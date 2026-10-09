// Phase 14: priority tiers, momentum rules, recommended-action hierarchy, flags, proposal states,
// ranking, diagnostics and the Ana Sayfa focus list. Pure: hand-built snapshots and work items.
import { describe, expect, it } from 'vitest';
import type { Company, CompanyHistoryEntry } from './company';
import type { FollowUpSequenceView } from './followUp';
import type { MailDraft } from './mail/draft';
import type { OutboundMessage, ThreadMessage } from './outreach';
import type { Readiness } from './outreachReadiness';
import type { Meeting, Proposal } from './sales';
import type { WorkItem } from './work';
import { companyInsights, compareInsights, focusList, priorityText, proposalState, salesIntelligence, type IntelligenceInput, type SalesInsight, type SalesSnapshot } from './salesIntelligence';
import { buildActivityIndex, companyActivity } from './salesActivity';
import { describeExternalContact, parseExternalContact } from './externalContact';

const NOW = '2026-10-09T09:00:00.000Z';
const ago = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(Date.parse(NOW) + days * 86_400_000).toISOString();

const entered = (label: string, days: number): CompanyHistoryEntry => ({ id: `h${days}${label}`, type: 'status_changed', description: `Durum Araştırıldı → ${label} olarak değiştirildi`, createdAt: ago(days), author: 'x' });

const company = (over: Partial<Company> = {}): Company => ({
  id: 'cmp_a', name: 'Aurora', website: null, sector: 'Diş Kliniği', sectorId: null, city: 'İzmir', country: 'Türkiye', companySize: null, source: 'manual', owner: 'Berk Çetinkaya',
  status: 'first_contact', opportunityScore: null, opportunities: [], contacts: [], notes: [], history: [], lastContactAt: null, nextAction: { label: 'Ara', dueAt: ahead(5) },
  createdAt: ago(40), updatedAt: ago(1), ...over,
});
const send = (companyId: string, days: number): OutboundMessage => ({ id: `snd${days}`, companyId, draftId: 'mail_1', contactId: null, recipientEmail: 'a@b.example', recipientName: null, fromEmail: null, subject: 's', body: 'b', service: 'crm', language: 'tr', revisionKey: 'k', provider: 'fixture', status: 'sent', gmailMessageId: null, gmailThreadId: 't', rfcMessageId: null, errorCode: null, errorMessage: null, resolution: null, attemptedAt: ago(days), sentAt: ago(days), createdAt: ago(days), updatedAt: ago(days) });
const msg = (companyId: string, days: number, direction: 'inbound' | 'outbound' = 'inbound'): ThreadMessage => ({ id: `m${days}${direction}`, outboundId: 'snd', companyId, gmailThreadId: 't', gmailMessageId: `g${days}${direction}`, rfcMessageId: null, direction, fromEmail: 'x@y.example', fromName: null, to: [], cc: [], subject: 's', bodyText: 'b', snippet: 'b', messageAt: ago(days), syncedAt: ago(days), attachments: [] });
const meeting = (companyId: string, at: string, status: Meeting['status'], createdDays = 10): Meeting => ({ id: `mt${at}`, companyId, scheduledAt: at, type: 'online', status, contactId: null, contactName: null, contactEmail: null, notes: '', outcome: '', nextActionLabel: null, nextActionDueAt: null, completedAt: status === 'completed' ? at : null, createdAt: ago(createdDays), updatedAt: ago(createdDays) });
const proposal = (companyId: string, over: Partial<Proposal> = {}): Proposal => ({ id: `prp_${over.status ?? 'sent'}`, companyId, title: 'CRM Kurulumu', currency: 'TRY', contractMonths: null, validUntil: null, notes: '', taxMode: 'unspecified', taxRateBp: null, status: 'sent', sentAt: ago(2), decidedAt: null, lossReason: null, createdAt: ago(5), updatedAt: ago(2), items: [], ...over } as Proposal);
const work = (companyId: string, kind: WorkItem['kind'], ageDays: number | null = 0, title = 'x'): WorkItem => ({ key: `${kind}:${companyId}`, source: 'next_action', group: 'sales', kind, title, description: title, companyId, companyName: 'Aurora', customerId: null, owner: null, dueAt: null, dueHasTime: false, refAt: null, bucket: 'overdue', ageDays, severity: 2, priority: null, link: { type: 'company', companyId }, actions: [], ref: {} });
const draft = (companyId: string, status: MailDraft['status'], updatedDays = 0): MailDraft => ({ id: 'mail_1', companyId, contactId: null, service: 'crm', language: 'tr', subjectOptions: ['a'], selectedSubject: 'a', body: 'b', status, createdAt: ago(updatedDays), updatedAt: ago(updatedDays), generatedAt: ago(updatedDays), approvedAt: status === 'approved' ? ago(updatedDays) : null, researchJobId: null, evidenceRefs: [], sectorContext: {} as MailDraft['sectorContext'], generationNotes: {} as MailDraft['generationNotes'], editedSinceGeneration: false, previousVersions: [] });
const fu = (companyId: string, queueGroup: FollowUpSequenceView['queueGroup'], dueAt = ahead(2)): FollowUpSequenceView => ({ id: 'fus_1', companyId, queueGroup, steps: [{ id: 's1', stepNumber: 1, status: 'scheduled', dueAt }], status: 'active' } as unknown as FollowUpSequenceView);

function run(over: Partial<SalesSnapshot> = {}, extra: { work?: WorkItem[]; readiness?: Record<string, Pick<Readiness, 'state' | 'reasons' | 'progress'>> } = {}) {
  const snapshot: SalesSnapshot = { companies: [company()], sends: [], messages: [], followUps: [], meetings: [], proposals: [], customers: [], drafts: [], ...over };
  const input: IntelligenceInput = { snapshot, workItems: extra.work ?? [], readiness: new Map(Object.entries(extra.readiness ?? {})), now: NOW };
  return companyInsights(input);
}
const one = (over: Partial<SalesSnapshot> = {}, extra: Parameters<typeof run>[1] = {}) => run(over, extra)[0];
const ready = { state: 'ready', reasons: [], progress: 'none' } as Pick<Readiness, 'state' | 'reasons' | 'progress'>;

describe('exclusions', () => {
  it.each(['client', 'lost', 'disqualified', 'not_interested'] as const)('%s gets no sales intelligence', (status) => {
    const i = one({ companies: [company({ status })] });
    expect(i.excluded).toBeTruthy();
    expect(i.priority).toBeNull();
    expect(i.action).toBeNull();
  });
  it('an active customer gets no sales recommendation; a completed customer is not excluded', () => {
    expect(one({ customers: [{ companyId: 'cmp_a', status: 'active' }] }).excluded).toMatch(/Aktif müşteri/);
    expect(one({ customers: [{ companyId: 'cmp_a', status: 'completed' }] }).excluded).toBeNull();
  });
});

describe('priority tiers (highest wins, every reason listed)', () => {
  it('Kritik: reply unanswered 1+ day; the reply-today case is Yüksek', () => {
    const c = company({ status: 'replied', history: [entered('Yanıt Geldi', 2)] });
    const crit = one({ companies: [c], sends: [send('cmp_a', 5)], messages: [msg('cmp_a', 2)] });
    expect(crit.priority).toEqual({ level: 'critical', reasons: expect.arrayContaining(['Yanıt geldi, 2 gündür dönüş yapılmadı']) });
    expect(priorityText(crit.priority!.level)).toBe('Öncelik: Kritik');
    const today = one({ companies: [c], sends: [send('cmp_a', 5)], messages: [msg('cmp_a', 0)] });
    expect(today.priority!.level).toBe('high');
  });
  it('a response after the reply (send, thread reply, meeting booked, proposal) clears the unanswered state', () => {
    const c = company({ status: 'replied' });
    expect(one({ companies: [c], messages: [msg('cmp_a', 4), msg('cmp_a', 3, 'outbound')] }).flags.map((f) => f.key)).not.toContain('reply_no_action');
    expect(one({ companies: [c], messages: [msg('cmp_a', 4)], meetings: [meeting('cmp_a', ahead(3), 'planned', 2)] }).flags.map((f) => f.key)).not.toContain('reply_no_action');
  });
  it('Kritik: expired sent proposal, meeting without outcome, accepted without customer, next action overdue > 3 days', () => {
    expect(one({ companies: [company({ status: 'proposal' })], proposals: [proposal('cmp_a', { validUntil: ago(1) })] }).priority!.level).toBe('critical');
    expect(one({}, { work: [work('cmp_a', 'meeting_no_outcome', 1, 'Görüşme sonucu girilmedi')] }).priority!.level).toBe('critical');
    expect(one({ companies: [company({ status: 'awaiting_decision' })], proposals: [proposal('cmp_a', { status: 'accepted', decidedAt: ago(1) })] }).priority!.reasons).toContain('Teklif kabul edildi, müşteri kaydı yok');
    expect(one({}, { work: [work('cmp_a', 'next_action_overdue', 4, 'Ara')] }).priority!.level).toBe('critical');
    expect(one({}, { work: [work('cmp_a', 'next_action_overdue', 3, 'Ara')] }).priority!.level).toBe('high');
  });
  it('Yüksek: meeting within 2 days, proposal waiting 7+ days, held meeting without proposal, follow up due, approved draft not sent', () => {
    expect(one({ companies: [company({ status: 'meeting' })], meetings: [meeting('cmp_a', ahead(2), 'planned')] }).priority!.reasons[0]).toMatch(/Görüşme yaklaşıyor/);
    expect(one({ companies: [company({ status: 'meeting' })], meetings: [meeting('cmp_a', ahead(3), 'planned')] }).priority!.level).not.toBe('high');
    expect(one({ companies: [company({ status: 'proposal' })], proposals: [proposal('cmp_a', { sentAt: ago(7) })] }).priority!.level).toBe('high');
    expect(one({ companies: [company({ status: 'meeting' })], meetings: [meeting('cmp_a', ago(2), 'completed')] }).priority!.reasons).toContain('Görüşme yapıldı, teklif yok');
    expect(one({}, { work: [work('cmp_a', 'follow_up_due', 1, '1. takip maili zamanı geldi')] }).priority!.level).toBe('high');
    expect(one({ companies: [company({ status: 'researched', nextAction: null })], drafts: [draft('cmp_a', 'approved')] }).priority!.reasons).toContain('Onaylı ilk temas taslağı gönderilmedi');
  });
  it('Orta: no next action in an open stage; draft waiting 2+ days; high potential not started and ready', () => {
    expect(one({ companies: [company({ nextAction: null })], sends: [send('cmp_a', 1)] }).priority).toEqual({ level: 'medium', reasons: ['Sonraki adım belirlenmedi'] });
    expect(one({ companies: [company({ status: 'researched', nextAction: null })], drafts: [draft('cmp_a', 'review', 2)] }).priority!.level).toBe('medium');
    expect(one({ companies: [company({ status: 'researched', nextAction: null })], drafts: [draft('cmp_a', 'review', 1)] }).priority!.level).toBe('normal');
    const hp = company({ status: 'researched', nextAction: null, opportunities: [{ service: 'crm', score: 80, reason: '', potential: 'high' }] });
    expect(one({ companies: [hp] }, { readiness: { cmp_a: ready } }).priority!.reasons).toContain('Yüksek potansiyel, iletişim başlamadı');
  });
  it('Normal with no signal; Şimdilik Bekle stays Normal and gets no recommendation', () => {
    expect(one({ sends: [send('cmp_a', 1)] }).priority).toEqual({ level: 'normal', reasons: ['Acil bir sinyal yok'] });
    const later = one({ companies: [company({ status: 'later' })], messages: [msg('cmp_a', 3)] });
    expect(later.priority).toEqual({ level: 'normal', reasons: ['Şimdilik Bekle aşamasında'] });
    expect(later.action).toBeNull();
    expect(later.flags.map((f) => f.key)).toContain('reply_no_action');
  });
  it('lists reasons from every tier, highest first', () => {
    const i = one({ companies: [company({ status: 'replied', nextAction: null })], messages: [msg('cmp_a', 3)] }, { work: [work('cmp_a', 'follow_up_due', 1, '1. takip maili zamanı geldi')] });
    expect(i.priority!.level).toBe('critical');
    expect(i.priority!.reasons).toEqual(['Yanıt geldi, 3 gündür dönüş yapılmadı', '1. takip maili zamanı geldi', 'Soğuyor: Yanıta 3 gündür dönülmedi.', 'Sonraki adım belirlenmedi']);
  });
});

describe('momentum', () => {
  it('pre-contact companies have not started; closed and later have none', () => {
    expect(one({ companies: [company({ status: 'researched' })] }).momentum!.state).toBe('not_started');
    expect(one({ companies: [company({ status: 'later' })] }).momentum).toBeNull();
  });
  it('Takıldı: 14+ days in stage and 14+ days quiet; or an expired sent proposal', () => {
    const c = company({ status: 'first_contact', history: [entered('İlk Temas', 20)], createdAt: ago(30) });
    expect(one({ companies: [c], sends: [send('cmp_a', 15)] }).momentum!.state).toBe('stuck');
    expect(one({ companies: [c], sends: [send('cmp_a', 13)] }).momentum!.state).not.toBe('stuck');
    expect(one({ companies: [company({ status: 'proposal', history: [entered('Teklif', 1)] })], proposals: [proposal('cmp_a', { validUntil: ago(2) })] }).momentum!.state).toBe('stuck');
  });
  it('Soğuyor: reply unanswered 3+ days, late follow up, proposal waiting, no outcome, 7+ quiet days without a booked meeting', () => {
    const c = company({ status: 'replied', history: [entered('Yanıt Geldi', 3)] });
    expect(one({ companies: [c], messages: [msg('cmp_a', 3)] }).momentum!.state).toBe('cooling');
    expect(one({ companies: [c], messages: [msg('cmp_a', 2)] }).momentum!.state).toBe('progressing');
    expect(one({ companies: [company({ history: [entered('İlk Temas', 1)] })] }, { work: [work('cmp_a', 'follow_up_due', 3)] }).momentum!.state).toBe('cooling');
    expect(one({ companies: [company({ status: 'proposal', history: [entered('Teklif', 1)] })], proposals: [proposal('cmp_a', { sentAt: ago(7) })] }).momentum!.state).toBe('cooling');
    const quiet = company({ status: 'first_contact', history: [entered('İlk Temas', 8)] });
    expect(one({ companies: [quiet], sends: [send('cmp_a', 8)] }).momentum!.state).toBe('cooling');
    expect(one({ companies: [quiet], sends: [send('cmp_a', 8)], meetings: [meeting('cmp_a', ahead(4), 'planned', 8)] }).momentum!.state).toBe('progressing');
  });
  it('İlerliyor: a forward event within 7 days; our own send alone is Bekliyor', () => {
    expect(one({ companies: [company({ status: 'meeting', history: [entered('Görüşme', 10)] })], meetings: [meeting('cmp_a', ago(2), 'completed', 10)], proposals: [proposal('cmp_a', { status: 'draft', sentAt: null, createdAt: ago(1) })] }).momentum!.state).toBe('progressing');
    expect(one({ companies: [company({ history: [entered('İlk Temas', 10)] })], sends: [send('cmp_a', 2)] }).momentum).toEqual({ state: 'waiting', reasons: ['Karşı taraftan dönüş bekleniyor.'] });
  });
});

describe('recommended next action (first match, advisory)', () => {
  const key = (i: SalesInsight) => i.action?.key ?? null;
  it('follows the hierarchy', () => {
    expect(key(one({ companies: [company({ status: 'awaiting_decision' })], proposals: [proposal('cmp_a', { status: 'accepted' })] }, { work: [work('cmp_a', 'meeting_no_outcome', 1)] }))).toBe('convert_customer');
    expect(key(one({ companies: [company({ status: 'replied' })], messages: [msg('cmp_a', 1)] }, { work: [work('cmp_a', 'meeting_no_outcome', 1)] }))).toBe('meeting_outcome');
    expect(one({ companies: [company({ status: 'replied' })], messages: [msg('cmp_a', 1)] }).action).toMatchObject({ key: 'answer_reply', label: 'Yanıta dön', link: { type: 'mail', companyId: 'cmp_a' } });
    expect(one({ companies: [company({ status: 'proposal' })], proposals: [proposal('cmp_a', { validUntil: ago(1) })] }).action!.link).toEqual({ type: 'proposal', proposalId: 'prp_sent' });
    expect(key(one({ companies: [company({ status: 'proposal' })], proposals: [proposal('cmp_a', { sentAt: ago(8) })] }))).toBe('proposal_follow_up');
    expect(key(one({ companies: [company({ status: 'meeting' })], proposals: [proposal('cmp_a', { status: 'draft', sentAt: null })] }))).toBe('proposal_finish');
    expect(one({ companies: [company({ status: 'meeting' })], meetings: [meeting('cmp_a', ago(2), 'completed')] }).action).toMatchObject({ key: 'proposal_create', link: { section: 'proposals' } });
    expect(one({ companies: [company({ status: 'replied' })], messages: [msg('cmp_a', 2), msg('cmp_a', 1, 'outbound')] }).action).toMatchObject({ key: 'meeting_plan', link: { section: 'meetings' } });
    expect(key(one({ sends: [send('cmp_a', 4)] }, { work: [work('cmp_a', 'follow_up_due', 0)] }))).toBe('follow_up_prepare');
    expect(one({ sends: [send('cmp_a', 1)], followUps: [fu('cmp_a', 'upcoming', ahead(2))] }).action).toMatchObject({ key: 'await_reply', detail: expect.stringMatching(/Sonraki takip/) });
  });
  it('pre-contact: approved draft → send; draft → review; ready → prepare; missing → specific fix; review → readiness', () => {
    const pre = company({ status: 'researched', nextAction: null });
    expect(key(one({ companies: [pre], drafts: [draft('cmp_a', 'approved')] }))).toBe('send_first_contact');
    expect(key(one({ companies: [pre], drafts: [draft('cmp_a', 'draft')] }))).toBe('review_draft');
    expect(key(one({ companies: [pre] }, { readiness: { cmp_a: ready } }))).toBe('prepare_draft');
    const missing = (code: string) => ({ cmp_a: { state: 'missing', reasons: [{ code, group: 'missing', message: 'm' }], progress: 'none' } as never });
    expect(one({ companies: [pre] }, { readiness: missing('no_contact') }).action).toMatchObject({ key: 'add_contact', link: { section: 'contacts' } });
    expect(key(one({ companies: [pre] }, { readiness: missing('no_service') }))).toBe('choose_service');
    expect(key(one({ companies: [pre] }, { readiness: missing('no_angle') }))).toBe('choose_angle');
    expect(key(one({ companies: [pre] }, { readiness: { cmp_a: { state: 'review', reasons: [{ code: 'probable_duplicate', group: 'review', message: 'Muhtemel tekrar' }], progress: 'none' } as never } }))).toBe('review_readiness');
  });
  it('open stage without a next action → set one; the planned next action is kept and shown separately', () => {
    expect(key(one({ companies: [company({ status: 'meeting', nextAction: null })], meetings: [meeting('cmp_a', ahead(4), 'planned')] }))).toBe('set_next_action');
    const i = one({ companies: [company({ status: 'replied', nextAction: { label: 'Cuma WhatsApp', dueAt: ahead(1) } })], messages: [msg('cmp_a', 2), msg('cmp_a', 1, 'outbound')] });
    expect(i.action!.label).toBe('Görüşme planla');
    expect(i.planned).toEqual({ label: 'Cuma WhatsApp', dueAt: ahead(1) });
  });
});

describe('flags and proposal states', () => {
  it('derives every flag with a reason', () => {
    const pre = company({ status: 'researched', nextAction: null, opportunities: [{ service: 'crm', score: 90, reason: '', potential: 'high' }] });
    expect(one({ companies: [pre] }, { readiness: { cmp_a: ready } }).flags.map((f) => f.key)).toEqual(['high_potential_not_started', 'ready_no_draft']);
    expect(one({ companies: [pre], drafts: [draft('cmp_a', 'review', 3)] }).flags.map((f) => f.key)).toContain('draft_not_approved');
    expect(one({ companies: [pre], drafts: [draft('cmp_a', 'approved')] }).flags.map((f) => f.key)).toContain('approved_not_sent');
    expect(one({}, { work: [work('cmp_a', 'follow_up_due', 1, '1. takip maili zamanı geldi')] }).flags.map((f) => f.key)).toContain('follow_up_late');
    expect(one({}, { work: [work('cmp_a', 'next_action_overdue', 2, 'Ara')] }).flags.map((f) => f.key)).toContain('next_action_overdue');
  });
  it('proposal states from status and dates', () => {
    expect(proposalState({ status: 'draft', sentAt: null, validUntil: null }, NOW)).toBe('preparing');
    expect(proposalState({ status: 'sent', sentAt: ago(2), validUntil: null }, NOW)).toBe('new');
    expect(proposalState({ status: 'sent', sentAt: ago(3), validUntil: null }, NOW)).toBe('deciding');
    expect(proposalState({ status: 'sent', sentAt: ago(7), validUntil: null }, NOW)).toBe('follow_up');
    expect(proposalState({ status: 'sent', sentAt: ago(1), validUntil: ago(1) }, NOW)).toBe('expired');
    expect(proposalState({ status: 'expired', sentAt: ago(1), validUntil: null }, NOW)).toBe('expired');
    expect(proposalState({ status: 'accepted', sentAt: ago(1), validUntil: null }, NOW)).toBe('accepted');
    expect(proposalState({ status: 'rejected', sentAt: ago(1), validUntil: null }, NOW)).toBe('rejected');
  });
});

describe('activity model', () => {
  it('next action edits, notes and draft changes never count as activity', () => {
    const c = company({ history: [entered('İlk Temas', 10), { id: 'n', type: 'note_added', description: 'not', createdAt: ago(0), author: 'x' }, { id: 'd', type: 'details_updated', description: 'Sonraki adım', createdAt: ago(0), author: 'x' }] });
    const a = companyActivity(c, buildActivityIndex({ sends: [], messages: [], meetings: [], proposals: [] }), NOW);
    expect(a.daysSinceActivity).toBe(10);
    expect(a.lastActivityKind).toBe('stage');
  });
});

describe('activity labels', () => {
  it('a reply and the stage change it caused at the same instant read as "Yanıt geldi"; creation reads as "Şirket eklendi"', () => {
    const c = company({ status: 'replied', history: [{ ...entered('Yanıt Geldi', 2), createdAt: ago(2) }] });
    const a = companyActivity(c, buildActivityIndex({ sends: [], messages: [msg('cmp_a', 2)], meetings: [], proposals: [] }), NOW);
    expect(a.lastActivityKind).toBe('reply');
    const fresh = companyActivity(company({ status: 'researched', history: [] }), buildActivityIndex({ sends: [], messages: [], meetings: [], proposals: [] }), NOW);
    expect(fresh.lastActivityKind).toBe('created');
  });
});

describe('external contact (Harici temas)', () => {
  const ext = (days: number, channel: 'whatsapp' | 'phone' = 'whatsapp', note = ''): CompanyHistoryEntry => ({ id: `x${days}`, type: 'external_contact', description: describeExternalContact(channel, note), createdAt: ago(days), author: 'Berk Çetinkaya' });
  const replied = (history: CompanyHistoryEntry[] = []) => company({ status: 'replied', nextAction: null, history: [entered('Yanıt Geldi', 3), ...history] });

  it('after the reply: clears the unanswered-reply critical reason, the flag and "Yanıta dön"', () => {
    const before = one({ companies: [replied()], messages: [msg('cmp_a', 3)] });
    expect(before.priority!.reasons).toContain('Yanıt geldi, 3 gündür dönüş yapılmadı');
    expect(before.action!.key).toBe('answer_reply');
    const after = one({ companies: [replied([ext(1, 'whatsapp', 'Fiyat istedi')])], messages: [msg('cmp_a', 3)] });
    expect(after.priority!.reasons.some((r) => r.startsWith('Yanıt geldi,'))).toBe(false);
    expect(after.flags.map((f) => f.key)).not.toContain('reply_no_action');
    expect(after.action!.key).toBe('meeting_plan');
    expect(after.lastExternalContact).toEqual({ at: ago(1), channel: 'whatsapp', label: 'WhatsApp', note: 'Fiyat istedi' });
    expect(after.lastActivity).toMatchObject({ kind: 'external', label: 'Harici temas', days: 1 });
  });

  it('before the reply: does not clear it', () => {
    const i = one({ companies: [replied([ext(5)])], messages: [msg('cmp_a', 3)] });
    expect(i.priority!.level).toBe('critical');
    expect(i.action!.key).toBe('answer_reply');
  });

  it('resets quiet time: a stalled / cooling deal with a fresh external contact is progressing', () => {
    const stalled = company({ status: 'first_contact', history: [entered('İlk Temas', 20)] });
    expect(one({ companies: [stalled], sends: [send('cmp_a', 20)] }).momentum!.state).toBe('stuck');
    const touched = company({ status: 'first_contact', history: [entered('İlk Temas', 20), ext(0, 'phone')] });
    const i = one({ companies: [touched], sends: [send('cmp_a', 20)] });
    expect(i.momentum!.state).toBe('progressing');
    expect(i.lastActivity).toMatchObject({ kind: 'external', days: 0 });
  });

  it('round-trips the history text; malformed or other entries are ignored', () => {
    expect(describeExternalContact('in_person', '  Kahve  içtik ')).toBe('Harici temas kaydedildi: Yüz yüze · Not: Kahve içtik');
    expect(parseExternalContact({ type: 'external_contact', description: 'Harici temas kaydedildi: Telefon', createdAt: NOW })).toEqual({ at: NOW, channel: 'phone', note: null });
    expect(parseExternalContact({ type: 'note_added', description: 'Harici temas kaydedildi: Telefon', createdAt: NOW })).toBeNull();
    expect(parseExternalContact({ type: 'external_contact', description: 'Harici temas kaydedildi: Faks', createdAt: NOW })).toBeNull();
  });
});

describe('ranking, diagnostics and focus', () => {
  it('ties: priority, momentum, later stage, longest wait, high potential, name', () => {
    const mk = (id: string, name: string, stage: SalesInsight['stage'], level: 'critical' | 'high' | 'medium' | 'normal', momentum: 'stuck' | 'cooling' | 'waiting', days: number, hp = false) =>
      ({ companyId: id, companyName: name, stage, priority: { level, reasons: [] }, momentum: { state: momentum, reasons: [] }, lastActivity: { at: NOW, kind: 'send', label: '', days }, daysInStage: days, highPotential: hp }) as unknown as SalesInsight;
    const list = [
      mk('a', 'A', 'replied', 'high', 'waiting', 1),
      mk('b', 'B', 'proposal', 'high', 'waiting', 1),
      mk('c', 'C', 'replied', 'critical', 'waiting', 1),
      mk('d', 'D', 'proposal', 'high', 'cooling', 1),
      mk('e', 'E', 'proposal', 'high', 'waiting', 5),
      mk('f', 'F', 'proposal', 'high', 'waiting', 5, true),
    ].sort(compareInsights);
    expect(list.map((i) => i.companyId)).toEqual(['c', 'd', 'f', 'e', 'b', 'a']);
  });
  it('diagnostics are plain counts; focus skips Bugün companies and Normal priority, at most 5', () => {
    const companies = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => company({ id: `cmp_${x}`, name: x.toUpperCase(), status: 'replied', nextAction: null }));
    const out = salesIntelligence({ snapshot: { companies, sends: [], messages: companies.map((c) => ({ ...msg(c.id, 2), id: `m_${c.id}`, gmailMessageId: `g_${c.id}` })), followUps: [], meetings: [], proposals: [], customers: [], drafts: [] }, workItems: [], readiness: new Map(), now: NOW });
    expect(out.diagnostics.openByStage.replied).toBe(7);
    expect(out.diagnostics.noNextAction).toBe(7);
    const focus = focusList(out.insights, new Set(['cmp_a', 'cmp_b']));
    expect(focus).toHaveLength(5);
    expect(focus.map((i) => i.companyId)).not.toContain('cmp_a');
    expect(focusList(out.insights.map((i) => ({ ...i, priority: { level: 'normal' as const, reasons: [] } })), new Set())).toEqual([]);
  });
});
