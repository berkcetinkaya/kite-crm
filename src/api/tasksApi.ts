// Browser client for manual tasks (Phase 11). Only manual tasks are written here; every other work
// item is changed through the endpoint that owns it.
import type { Company } from '../domain/company';
import type { Task, TaskInput, TaskStatus } from '../domain/tasks';
import type { WorkResponse } from '../domain/work';
import { request } from './dataApi';

export type TaskResult = { task: Task; company: Company | null };

export const tasksApi = {
  work: (completedDays: number, signal?: AbortSignal) => request<WorkResponse>('GET', `/api/work?completed=${completedDays}`, undefined, signal),
  forCompany: (companyId: string, signal?: AbortSignal) => request<{ tasks: Task[] }>('GET', `/api/tasks?company=${encodeURIComponent(companyId)}`, undefined, signal),
  create: (task: TaskInput) => request<TaskResult>('POST', '/api/tasks', { task }),
  update: (id: string, task: TaskInput) => request<TaskResult>('PUT', `/api/tasks/${id}`, { task }),
  changeStatus: (id: string, to: TaskStatus) => request<TaskResult>('POST', `/api/tasks/${id}/status`, { to }),
};
