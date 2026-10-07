// Manual tasks (Phase 11): small reminders that have no other home. Everything else on İşler is derived
// from its own record (next actions, meetings, follow-ups, onboarding, access, proposals) and never
// copied here. No subtasks, dependencies, recurrence, attachments or external reminders.
//
// A due date is the reminder: it shows as overdue / today / upcoming inside KITE OS only.

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { open: 'Açık', done: 'Tamamlandı', cancelled: 'İptal' };

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { low: 'Düşük', normal: 'Normal', high: 'Yüksek' };

/** Explicit status changes; every closed task can be reopened. */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ['done', 'cancelled'],
  done: ['open'],
  cancelled: ['open'],
};

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Date-only due dates are stored at local noon (like every date input); see `dueHasTime`. */
  dueAt: string | null;
  dueHasTime: boolean;
  /** Same source as company.owner (TEAM_MEMBERS). */
  owner: string | null;
  companyId: string | null;
  /** When set, `companyId` is the customer's company. */
  customerId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set when the task is closed (done or cancelled); cleared on reopen. */
  closedAt: string | null;
}

export interface TaskInput {
  title: string;
  notes: string;
  priority: TaskPriority;
  dueAt: string | null;
  dueHasTime: boolean;
  owner: string | null;
  companyId: string | null;
  customerId: string | null;
}

export const TASK_TITLE_MAX = 200;
export const TASK_NOTES_MAX = 4000;
/** Tamamlananlar shows tasks done within this many days (a "Daha eski" view widens it). */
export const COMPLETED_RECENT_DAYS = 30;
export const COMPLETED_OLDER_DAYS = 90;

export type TaskErrorCode = 'task_not_found' | 'task_invalid' | 'task_invalid_transition' | 'task_secret' | 'task_link_invalid';

export const TASK_ERROR_MESSAGES: Record<TaskErrorCode, string> = {
  task_not_found: 'Görev bulunamadı.',
  task_invalid: 'Görev bilgileri geçersiz.',
  task_invalid_transition: 'Bu görev durumu bu şekilde değiştirilemez.',
  task_secret: 'Şifre, API key veya token saklamayın. Görevde erişim bilgisi gibi görünen bir değer var; kaldırıp tekrar dene.',
  task_link_invalid: 'Seçilen şirket veya müşteri bulunamadı ya da birbiriyle eşleşmiyor.',
};
