// Shared work-item derivation (Phase 11). Pure: (snapshot of existing records, now) → WorkItem[].
// One adapter per source; each record yields at most one item, so keys are unique by construction.
// Ana Sayfa's Bugün (Phase 10 attention queue) is a projection of these items: `attentionFromWork`.
import { CRITICAL_OVERDUE_DAYS, dayKey, daysBetween, dueBucket, PROPOSAL_WAITING_DAYS } from '../../src/domain/businessDay';
import type { Company } from '../../src/domain/company';
import { ACCESS_STATUS_LABELS, type Customer } from '../../src/domain/customers';
import { CLOSED_COMPANY_STATUSES, type AttentionItem, type AttentionSeverity } from '../../src/domain/dashboard';
import { currentStepOf, type FollowUpSequenceView } from '../../src/domain/followUp';
import { MEETING_TYPE_LABELS, type Meeting, type Proposal } from '../../src/domain/sales';
import type { Task } from '../../src/domain/tasks';
import { SOURCE_GROUP, type WorkItem } from '../../src/domain/work';
import { formatShortDate, formatTime } from '../../src/lib/date';
import { compareTr } from '../../src/lib/text';

export interface WorkSnapshot {
  companies: Company[];
  followUps: FollowUpSequenceView[];
  meetings: Meeting[];
  proposals: Proposal[];
  customers: Customer[];
  /** Open manual tasks (optional so Phase 10 snapshots stay valid). */
  tasks?: Task[];
}

const since = (iso: string | null | undefined, now: string) => (iso ? Math.max(0, daysBetween(iso, now)) : null);
const short = (iso: string) => formatShortDate(new Date(iso));
const plusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

type Draft = Omit<WorkItem, 'group' | 'companyName' | 'owner' | 'bucket' | 'priority' | 'dueHasTime' | 'actions' | 'ref'> &
  Partial<Pick<WorkItem, 'bucket' | 'priority' | 'dueHasTime' | 'actions' | 'ref' | 'owner'>>;

/** Every open work item in source order (records keep their own order, e.g. checklist position). */
export function collectWorkItems(snap: WorkSnapshot, now: string): WorkItem[] {
  const today = dayKey(now);
  const byId = new Map(snap.companies.map((c) => [c.id, c]));
  const closed = (id: string | null) => !!id && CLOSED_COMPANY_STATUSES.includes(byId.get(id)?.status ?? 'found');
  const items: WorkItem[] = [];
  const push = (d: Draft) =>
    items.push({
      ...d,
      group: SOURCE_GROUP[d.source],
      companyName: d.companyId ? (byId.get(d.companyId)?.name ?? 'Şirket') : null,
      owner: d.owner !== undefined ? d.owner : d.companyId ? (byId.get(d.companyId)?.owner ?? null) : null,
      bucket: d.bucket ?? dueBucket(d.dueAt, now),
      priority: d.priority ?? null,
      dueHasTime: d.dueHasTime ?? false,
      actions: d.actions ?? [],
      ref: d.ref ?? {},
    });

  // ----- Manual tasks -----
  for (const t of snap.tasks ?? []) {
    if (t.status !== 'open') continue;
    const bucket = dueBucket(t.dueAt, now);
    const late = bucket === 'overdue' ? daysBetween(t.dueAt!, now) : null;
    const severity: AttentionSeverity | null = bucket === 'overdue' ? (late! > CRITICAL_OVERDUE_DAYS || t.priority === 'high' ? 1 : 2) : bucket === 'today' ? 2 : null;
    push({
      key: `task:${t.id}`,
      source: 'task',
      kind: 'task',
      title: t.title,
      description: t.notes.split('\n')[0].slice(0, 160),
      companyId: t.companyId,
      customerId: t.customerId,
      owner: t.owner,
      dueAt: t.dueAt,
      dueHasTime: t.dueHasTime,
      refAt: t.dueAt,
      bucket,
      ageDays: late ?? (bucket === 'today' ? 0 : null),
      severity,
      priority: t.priority,
      link: { type: 'task', taskId: t.id },
      actions: [{ type: 'task_status', to: 'done' }, { type: 'task_edit' }, { type: 'task_status', to: 'cancelled' }],
      ref: { taskId: t.id, status: t.status },
    });
  }

  // ----- Customers: access, onboarding items, missing next action (never a generic "blocked" row) -----
  for (const c of snap.customers) {
    if (c.status === 'completed' || c.status === 'lost') continue;
    const link = { type: 'customer' as const, customerId: c.id };
    for (const a of c.access) {
      if (a.status === 'received') continue;
      const base = { source: 'access' as const, title: a.label, companyId: c.companyId, customerId: c.id, dueAt: null, link, actions: [{ type: 'access_status' as const }], ref: { accessId: a.id, status: a.status } };
      if (a.status === 'problem') push({ ...base, key: `access:${a.id}`, kind: 'access_problem', description: `${a.label}: Sorun Var`, refAt: a.updatedAt, ageDays: since(a.updatedAt, now), severity: 1 });
      else if (a.status === 'requested')
        push({ ...base, key: `access:${a.id}`, kind: 'access_requested', description: `${ACCESS_STATUS_LABELS.requested} · müşteriden bekleniyor`, refAt: a.requestedAt, ageDays: since(a.requestedAt, now), severity: null });
      else push({ ...base, key: `access:${a.id}`, kind: 'access_not_requested', description: 'Henüz istenmedi', refAt: null, ageDays: null, severity: null });
    }
    for (const i of c.onboarding) {
      if (i.status !== 'pending' && i.status !== 'in_progress') continue;
      const bucket = dueBucket(i.dueDate, now);
      push({
        key: `onb:${i.id}`,
        source: 'onboarding',
        kind: bucket === 'overdue' ? 'onboarding_overdue' : bucket === 'today' ? 'onboarding_today' : 'onboarding_open',
        title: i.label,
        description: bucket === 'overdue' ? 'Onboarding adımı gecikti' : bucket === 'today' ? 'Onboarding adımının son günü bugün' : 'Onboarding adımı',
        companyId: c.companyId,
        customerId: c.id,
        dueAt: i.dueDate,
        refAt: i.dueDate,
        bucket,
        ageDays: bucket === 'overdue' ? since(i.dueDate, now) : bucket === 'today' ? 0 : null,
        severity: bucket === 'overdue' ? 1 : bucket === 'today' ? 2 : null,
        link,
        actions: [{ type: 'onboarding_status' }],
        ref: { onboardingItemId: i.id, status: i.status },
      });
    }
    if ((c.status === 'active' || c.status === 'on_hold') && !byId.get(c.companyId)?.nextAction)
      push({ key: `customer-next:${c.id}`, source: 'customer', kind: 'customer_no_next_action', title: 'Sonraki adım belirle', description: 'Müşteri için sonraki adım belirlenmedi', companyId: c.companyId, customerId: c.id, dueAt: null, refAt: null, ageDays: null, severity: 3, link, actions: [{ type: 'next_action_set' }] });
  }

  // ----- Follow-ups (planner's read-only views; never generates or sends) -----
  for (const s of snap.followUps) {
    const step = currentStepOf(s);
    const link = { type: 'mail' as const, companyId: s.companyId };
    const base = { key: `follow-up:${s.id}`, source: 'follow_up' as const, companyId: s.companyId, customerId: null, link };
    if (s.queueGroup === 'due') {
      const text = `${step?.stepNumber ?? ''}. takip maili zamanı geldi`.trim();
      push({ ...base, kind: 'follow_up_due', title: text, description: text, dueAt: step?.dueAt ?? null, refAt: step?.dueAt ?? null, ageDays: since(step?.dueAt, now), severity: 2 });
    } else if (s.queueGroup === 'attention') {
      const text = s.blockers[0] ?? (s.status === 'paused' ? 'Takip planı duraklatıldı' : 'Takip planı engelli');
      push({ ...base, kind: 'follow_up_blocked', title: 'Takip planı dikkat istiyor', description: text, dueAt: null, refAt: null, ageDays: null, severity: 2 });
    } else if (s.queueGroup === 'prepared' || s.queueGroup === 'approved') {
      const text = s.queueGroup === 'prepared' ? `${step?.stepNumber ?? ''}. takip taslağı onay bekliyor` : `${step?.stepNumber ?? ''}. takip onaylandı, gönderilmedi`;
      push({ ...base, kind: 'follow_up_waiting', title: text.trim(), description: "Mail & Takip'te incele", dueAt: step?.dueAt ?? null, refAt: step?.dueAt ?? null, ageDays: since(step?.dueAt, now), severity: null });
    } else if (s.queueGroup === 'upcoming') {
      push({ ...base, kind: 'follow_up_upcoming', title: `${step?.stepNumber ?? ''}. takip maili`.trim(), description: 'Planlandı', dueAt: step?.dueAt ?? null, refAt: step?.dueAt ?? null, ageDays: null, severity: null });
    }
  }

  // ----- Meetings (planned only; the outcome is entered in the meeting form) -----
  for (const m of snap.meetings) {
    if (m.status !== 'planned') continue;
    const link = { type: 'company' as const, companyId: m.companyId };
    const base = { key: `meeting:${m.id}`, source: 'meeting' as const, companyId: m.companyId, customerId: null, dueAt: m.scheduledAt, dueHasTime: true, refAt: m.scheduledAt, link };
    const who = m.contactName ? ` · ${m.contactName}` : '';
    if (m.scheduledAt < now) push({ ...base, kind: 'meeting_no_outcome', title: 'Görüşme sonucu girilmedi', description: `${short(m.scheduledAt)} görüşmesinin sonucu girilmedi`, bucket: 'overdue', ageDays: since(m.scheduledAt, now), severity: 2 });
    else if (dayKey(m.scheduledAt) === today) push({ ...base, kind: 'meeting_today', title: `Görüşme ${formatTime(new Date(m.scheduledAt))}`, description: `Bugün görüşme${who}`, ageDays: 0, severity: 3 });
    else push({ ...base, kind: 'meeting_upcoming', title: 'Planlı görüşme', description: `${MEETING_TYPE_LABELS[m.type]}${who}`, ageDays: null, severity: null });
  }

  // ----- Company next actions (one per company) -----
  for (const c of snap.companies) {
    if (!c.nextAction || CLOSED_COMPANY_STATUSES.includes(c.status)) continue;
    const due = c.nextAction.dueAt;
    const bucket = dueBucket(due, now);
    const late = bucket === 'overdue' ? daysBetween(due!, now) : null;
    push({
      key: `next:${c.id}`,
      source: 'next_action',
      kind: bucket === 'overdue' ? 'next_action_overdue' : bucket === 'today' ? 'next_action_today' : 'next_action',
      title: c.nextAction.label,
      description: c.nextAction.label,
      companyId: c.id,
      customerId: null,
      dueAt: due,
      refAt: due,
      bucket,
      ageDays: late ?? (bucket === 'today' ? 0 : null),
      severity: bucket === 'overdue' ? (late! > CRITICAL_OVERDUE_DAYS ? 1 : 2) : bucket === 'today' ? 2 : null,
      link: { type: 'company', companyId: c.id },
      actions: [{ type: 'next_action_clear' }, { type: 'next_action_edit' }],
    });
  }

  // ----- Proposals awaiting a decision (one per proposal; expired outranks waiting) -----
  for (const p of snap.proposals) {
    if (p.status !== 'sent' || !p.sentAt || closed(p.companyId)) continue;
    const waiting = since(p.sentAt, now) ?? 0;
    const expired = !!p.validUntil && dayKey(p.validUntil) < today;
    const base = { key: `proposal:${p.id}`, source: 'proposal' as const, companyId: p.companyId, customerId: null, refAt: p.sentAt, ageDays: waiting, link: { type: 'proposal' as const, proposalId: p.id } };
    if (expired)
      push({ ...base, kind: 'proposal_waiting', title: `“${p.title}” geçerlilik tarihi geçti`, description: `“${p.title}” geçerlilik tarihi geçti (${short(p.validUntil!)}), karar bekleniyor`, dueAt: p.validUntil, bucket: 'overdue', severity: 1 });
    else if (waiting >= PROPOSAL_WAITING_DAYS)
      push({ ...base, kind: 'proposal_waiting', title: `“${p.title}” karar bekliyor`, description: `“${p.title}” ${waiting} gündür karar bekliyor`, dueAt: plusDays(p.sentAt, PROPOSAL_WAITING_DAYS), bucket: waiting === PROPOSAL_WAITING_DAYS ? 'today' : 'overdue', severity: 2 });
    else push({ ...base, kind: 'proposal_sent', title: `“${p.title}” karar bekliyor`, description: `${waiting} gündür gönderildi · ${PROPOSAL_WAITING_DAYS}. günde takip`, dueAt: plusDays(p.sentAt, PROPOSAL_WAITING_DAYS), severity: null });
  }

  return items;
}

/** İşler list: every open work item, most urgent first. */
export const deriveWorkItems = (snap: WorkSnapshot, now: string): WorkItem[] => collectWorkItems(snap, now).sort(WORK_ORDER);

const BUCKET_ORDER = { overdue: 0, today: 1, upcoming: 2, later: 3, undated: 4 } as const;

/** İşler order: severity (urgent first), then bucket; overdue / undated by age, the rest by due date. */
export const WORK_ORDER = (a: WorkItem, b: WorkItem) =>
  (a.severity ?? 9) - (b.severity ?? 9) ||
  BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
  (a.bucket === 'overdue' || a.bucket === 'undated' ? (b.ageDays ?? -1) - (a.ageDays ?? -1) : 0) ||
  (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9') ||
  compareTr(a.companyName ?? a.title, b.companyName ?? b.title) ||
  a.key.localeCompare(b.key);

/** Phase 10 Bugün order (unchanged). */
const SEVERITY_ORDER = (a: AttentionItem, b: AttentionItem) =>
  a.severity - b.severity || (b.ageDays ?? -1) - (a.ageDays ?? -1) || compareTr(a.companyName, b.companyName) || a.key.localeCompare(b.key);

/**
 * Ana Sayfa's Bugün: every work item with a severity (pass `collectWorkItems` output so grouped
 * onboarding rows list items in checklist order). Onboarding stays grouped per customer there
 * (one row for overdue items, one for items due today); on İşler each item is its own row.
 */
export function attentionFromWork(items: WorkItem[]): AttentionItem[] {
  const out: AttentionItem[] = [];
  const onboarding = new Map<string, { overdue: WorkItem[]; today: WorkItem[] }>();
  for (const w of items) {
    if (w.severity === null) continue;
    if (w.source === 'onboarding') {
      const g = onboarding.get(w.customerId!) ?? { overdue: [], today: [] };
      (w.kind === 'onboarding_overdue' ? g.overdue : g.today).push(w);
      onboarding.set(w.customerId!, g);
      continue;
    }
    const kind = w.source === 'task' ? (w.bucket === 'overdue' ? 'task_overdue' : 'task_today') : (w.kind as AttentionItem['kind']);
    out.push({ key: w.key, kind, severity: w.severity, companyId: w.companyId ?? '', companyName: w.companyName ?? '', description: w.source === 'task' ? w.title : w.description, at: w.refAt, ageDays: w.ageDays, owner: w.owner, link: w.link });
  }
  for (const [customerId, g] of onboarding) {
    const first = (g.overdue[0] ?? g.today[0])!;
    if (g.overdue.length) {
      const earliest = g.overdue.map((w) => w.dueAt!).sort()[0];
      out.push({ key: `onboarding:${customerId}`, kind: 'onboarding_overdue', severity: 1, companyId: first.companyId!, companyName: first.companyName!, description: `${g.overdue.length} gecikmiş adım: ${g.overdue.map((w) => w.title).join(', ')}`, at: earliest, ageDays: Math.max(...g.overdue.map((w) => w.ageDays ?? 0)), owner: first.owner, link: first.link });
    }
    if (g.today.length)
      out.push({ key: `onboarding-today:${customerId}`, kind: 'onboarding_today', severity: 2, companyId: first.companyId!, companyName: first.companyName!, description: `${g.today.length} adımın son günü bugün: ${g.today.map((w) => w.title).join(', ')}`, at: g.today[0].dueAt, ageDays: 0, owner: first.owner, link: first.link });
  }
  return out.sort(SEVERITY_ORDER);
}

