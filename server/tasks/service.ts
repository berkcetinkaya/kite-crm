// Manual task service (Phase 11). Small reminders only; every other work item stays in its own table.
//
// Rules enforced here (the browser only mirrors them):
//   - Status changes are explicit: open → done / cancelled, done / cancelled → open (reopen).
//   - closed_at is set when a task is closed (done or cancelled) and cleared on reopen.
//   - A customer-linked task always carries the customer's company.
//   - Company history gets exactly one entry per explicit "Tamamlandı" of a company-linked task;
//     creating, editing, reopening and cancelling only touch the task's own timestamps.
//   - No secrets: titles / notes that clearly contain credentials are refused.
import type { Company } from '../../src/domain/company';
import { containsSecret } from '../../src/domain/customers';
import { TASK_ERROR_MESSAGES, TASK_TRANSITIONS, type Task, type TaskErrorCode, type TaskInput, type TaskStatus } from '../../src/domain/tasks';
import { createId } from '../../src/lib/id';
import { actionMeta } from '../../src/state/companies/companyCommands';
import { companiesReducer } from '../../src/state/companies/companiesReducer';
import type { Store } from '../db/store';

const HTTP: Record<TaskErrorCode, number> = { task_not_found: 404, task_invalid: 400, task_invalid_transition: 409, task_secret: 400, task_link_invalid: 400 };

export class TaskError extends Error {
  readonly status: number;
  constructor(
    public readonly code: TaskErrorCode,
    message?: string,
  ) {
    super(message ?? TASK_ERROR_MESSAGES[code]);
    this.name = 'TaskError';
    this.status = HTTP[code];
  }
}

export interface TaskResult {
  task: Task;
  /** The linked company after the change (history), when the task has one. */
  company: Company | null;
}

export function createTaskService(store: Store, deps: { now?: () => Date } = {}) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  function taskOf(id: string): Task {
    const t = store.tasks.get(id);
    if (!t) throw new TaskError('task_not_found');
    return t;
  }

  /** Validates links and returns the normalised { companyId, customerId }. */
  function links(input: Pick<TaskInput, 'companyId' | 'customerId'>) {
    if (input.customerId) {
      const customer = store.customers.get(input.customerId);
      if (!customer || (input.companyId && input.companyId !== customer.companyId)) throw new TaskError('task_link_invalid');
      return { companyId: customer.companyId, customerId: customer.id };
    }
    if (input.companyId && !store.companies.get(input.companyId)) throw new TaskError('task_link_invalid');
    return { companyId: input.companyId ?? null, customerId: null };
  }

  function fields(input: TaskInput) {
    const title = input.title.trim();
    const notes = input.notes.trim();
    if (!title) throw new TaskError('task_invalid', 'Görev başlığını yaz.');
    if (containsSecret(title) || containsSecret(notes)) throw new TaskError('task_secret');
    return {
      title,
      notes,
      priority: input.priority,
      dueAt: input.dueAt,
      dueHasTime: input.dueAt ? input.dueHasTime : false,
      owner: input.owner?.trim() || null,
      ...links(input),
    };
  }

  const companyFor = (t: Task) => (t.companyId ? store.companies.get(t.companyId) : null);
  const result = (t: Task): TaskResult => ({ task: t, company: companyFor(t) });

  return {
    get: (id: string) => taskOf(id),
    listOpen: () => store.tasks.listOpen(),
    listDoneSince: (since: string) => store.tasks.listDoneSince(since),
    listOpenForCompany: (companyId: string) => store.tasks.listByCompany(companyId).filter((t) => t.status === 'open'),

    create(input: TaskInput): TaskResult {
      return store.transaction(() => {
        const at = now();
        const task: Task = { id: createId('tsk'), ...fields(input), status: 'open', createdAt: at, updatedAt: at, closedAt: null };
        store.tasks.save(task);
        return result(task);
      });
    },

    update(id: string, input: TaskInput): TaskResult {
      return store.transaction(() => {
        const current = taskOf(id);
        const task: Task = { ...current, ...fields(input), updatedAt: now() };
        store.tasks.save(task);
        return result(task);
      });
    },

    changeStatus(id: string, to: TaskStatus): TaskResult {
      return store.transaction(() => {
        const at = now();
        const current = taskOf(id);
        if (!TASK_TRANSITIONS[current.status].includes(to)) throw new TaskError('task_invalid_transition');
        const task: Task = { ...current, status: to, closedAt: to === 'open' ? null : at, updatedAt: at };
        store.tasks.save(task);
        // One history entry, only for an explicit completion of a company-linked task.
        if (to === 'done' && task.companyId) {
          const company = store.companies.get(task.companyId);
          if (company) {
            const [next] = companiesReducer([company], { type: 'customerEvent', id: company.id, event: 'task', description: `Görev tamamlandı: ${task.title}`, meta: actionMeta(at) });
            if (next !== company) store.companies.save(next);
          }
        }
        return result(task);
      });
    },
  };
}

export type TaskServiceApi = ReturnType<typeof createTaskService>;
