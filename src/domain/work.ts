// Work items (Phase 11): one read-only view over every open piece of work. Each item is derived from
// the record that owns it (manual task, company next action, meeting, follow-up step, onboarding item,
// access requirement, proposal, customer); nothing is copied or stored. İşler shows them all; Ana
// Sayfa's Bugün is the subset with a severity, so both always agree about today / overdue / urgent.
import type { DueBucket } from './businessDay';
import type { AttentionSeverity, DashboardLink } from './dashboard';
import type { AccessStatus, OnboardingStatus } from './customers';
import type { Task, TaskPriority, TaskStatus } from './tasks';

export const WORK_SOURCES = ['task', 'next_action', 'meeting', 'follow_up', 'onboarding', 'access', 'proposal', 'customer'] as const;
export type WorkSource = (typeof WORK_SOURCES)[number];
export const WORK_SOURCE_LABELS: Record<WorkSource, string> = {
  task: 'Manuel Görev',
  next_action: 'Sonraki Adım',
  meeting: 'Görüşme',
  follow_up: 'Takip',
  onboarding: 'Onboarding',
  access: 'Erişim',
  proposal: 'Teklif',
  customer: 'Müşteri',
};

/** Source-type filter groups on İşler. */
export const WORK_GROUPS = ['manual', 'sales', 'follow_up', 'customer'] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];
export const WORK_GROUP_LABELS: Record<WorkGroup, string> = { manual: 'Manuel', sales: 'Satış', follow_up: 'Takip', customer: 'Müşteri' };
export const SOURCE_GROUP: Record<WorkSource, WorkGroup> = {
  task: 'manual',
  next_action: 'sales',
  meeting: 'sales',
  proposal: 'sales',
  follow_up: 'follow_up',
  onboarding: 'customer',
  access: 'customer',
  customer: 'customer',
};

export const WORK_KINDS = [
  'task',
  'next_action_overdue',
  'next_action_today',
  'next_action',
  'meeting_no_outcome',
  'meeting_today',
  'meeting_upcoming',
  'follow_up_due',
  'follow_up_blocked',
  'follow_up_waiting',
  'follow_up_upcoming',
  'proposal_waiting',
  'proposal_sent',
  'onboarding_overdue',
  'onboarding_today',
  'onboarding_open',
  'access_problem',
  'access_requested',
  'access_not_requested',
  'customer_no_next_action',
] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/**
 * Inline actions İşler may offer. Each one calls the endpoint that owns the record (no shortcuts):
 * manual tasks → /api/tasks; next action → company details; onboarding / access → Phase 9 status
 * endpoints. Meetings, follow-ups and proposals only open their own pages.
 */
export type WorkAction =
  | { type: 'task_status'; to: TaskStatus }
  | { type: 'task_edit' }
  | { type: 'next_action_clear' }
  | { type: 'next_action_edit' }
  | { type: 'next_action_set' }
  | { type: 'onboarding_status' }
  | { type: 'access_status' };

export type WorkLink = DashboardLink;

export interface WorkItem {
  /** Stable and unique per source record (e.g. "task:tsk_…", "onb:onb_…"). */
  key: string;
  source: WorkSource;
  group: WorkGroup;
  kind: WorkKind;
  /** Main line on İşler. */
  title: string;
  /** Secondary line (also the Bugün description for Phase 10 kinds). */
  description: string;
  companyId: string | null;
  companyName: string | null;
  customerId: string | null;
  owner: string | null;
  /** When the work is due (drives the bucket); null = undated. */
  dueAt: string | null;
  dueHasTime: boolean;
  /** The date Phase 10 shows for this signal (send date, update date…). */
  refAt: string | null;
  bucket: DueBucket;
  /** Days overdue / waiting (0 = today); null when not applicable. */
  ageDays: number | null;
  /** Non-null items appear in Ana Sayfa's Bugün. */
  severity: AttentionSeverity | null;
  priority: TaskPriority | null;
  link: WorkLink;
  actions: WorkAction[];
  /** Ids and current state needed by inline actions. */
  ref: { taskId?: string; onboardingItemId?: string; accessId?: string; status?: OnboardingStatus | AccessStatus | TaskStatus };
}

export interface WorkResponse {
  now: string;
  items: WorkItem[];
  /** Open manual tasks (full records, for editing). */
  tasks: Task[];
  /** Manual tasks marked Tamamlandı within `completedDays` (cancelled tasks are not completed). */
  completed: Task[];
  completedDays: number;
}

export const WORK_VIEWS = ['today', 'overdue', 'upcoming', 'completed', 'all'] as const;
export type WorkView = (typeof WORK_VIEWS)[number];
export const WORK_VIEW_LABELS: Record<WorkView, string> = { today: 'Bugün', overdue: 'Gecikmiş', upcoming: 'Yaklaşan', completed: 'Tamamlananlar', all: 'Tümü' };

/** Which open items a view shows. "Bugün" = due today or overdue, plus everything Ana Sayfa's Bugün shows. */
export function inView(item: WorkItem, view: Exclude<WorkView, 'completed'>): boolean {
  switch (view) {
    case 'today':
      return item.bucket === 'overdue' || item.bucket === 'today' || item.severity !== null;
    case 'overdue':
      return item.bucket === 'overdue';
    case 'upcoming':
      return item.bucket === 'upcoming';
    case 'all':
      return true;
  }
}
