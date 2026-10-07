// SQLite repository for manual tasks (Phase 11).
import type { Task } from '../../../src/domain/tasks';
import type { Db } from '../sqlite';
import type { TaskRepository } from './types';

type Row = Record<string, unknown>;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));

const toTask = (r: Row): Task => ({
  id: r.id as string,
  title: r.title as string,
  notes: r.notes as string,
  status: r.status as Task['status'],
  priority: r.priority as Task['priority'],
  dueAt: sn(r.due_at),
  dueHasTime: Number(r.due_has_time) === 1,
  owner: sn(r.owner),
  companyId: sn(r.company_id),
  customerId: sn(r.customer_id),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  closedAt: sn(r.closed_at),
});

export function createTaskRepository(db: Db): TaskRepository {
  // Prepared on first use (the store may be built before migrations reach v6 in upgrade tests).
  let prepared: ReturnType<typeof prepare> | null = null;
  const prepare = () => ({
    get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    open: db.prepare("SELECT * FROM tasks WHERE status = 'open' ORDER BY due_at IS NULL, due_at, created_at"),
    doneSince: db.prepare("SELECT * FROM tasks WHERE status = 'done' AND closed_at >= ? ORDER BY closed_at DESC"),
    byCompany: db.prepare('SELECT * FROM tasks WHERE company_id = ? ORDER BY created_at'),
    upsert: db.prepare(`INSERT INTO tasks (id, title, notes, status, priority, due_at, due_has_time, owner, company_id, customer_id, created_at, updated_at, closed_at)
      VALUES (:id, :title, :notes, :status, :priority, :due_at, :due_has_time, :owner, :company_id, :customer_id, :created_at, :updated_at, :closed_at)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, notes = excluded.notes, status = excluded.status, priority = excluded.priority,
      due_at = excluded.due_at, due_has_time = excluded.due_has_time, owner = excluded.owner, company_id = excluded.company_id,
      customer_id = excluded.customer_id, updated_at = excluded.updated_at, closed_at = excluded.closed_at`),
  });
  const q = () => (prepared ??= prepare());

  return {
    get(id) {
      const r = q().get.get(id) as Row | undefined;
      return r ? toTask(r) : null;
    },
    listOpen: () => (q().open.all() as Row[]).map(toTask),
    listDoneSince: (since) => (q().doneSince.all(since) as Row[]).map(toTask),
    listByCompany: (companyId) => (q().byCompany.all(companyId) as Row[]).map(toTask),
    save(t) {
      q().upsert.run({
        id: t.id,
        title: t.title,
        notes: t.notes,
        status: t.status,
        priority: t.priority,
        due_at: t.dueAt,
        due_has_time: t.dueHasTime ? 1 : 0,
        owner: t.owner,
        company_id: t.companyId,
        customer_id: t.customerId,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        closed_at: t.closedAt,
      });
    },
  };
}
