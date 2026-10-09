// Shared Ana Sayfa helpers (Phase 10): drill-down links into existing pages and short Turkish ages.
import type { ReactNode } from 'react';
import type { AttentionItem, DashboardLink } from '../../domain/dashboard';
import { formatShortDate, formatTime } from '../../lib/date';
import { customerHref } from '../customers/customersView';
import { mailHref } from '../mail/routes';

export const PROPOSALS_ROUTE = '#/proposals';
export const proposalHref = (id: string) => `${PROPOSALS_ROUTE}?proposal=${encodeURIComponent(id)}`;

export function linkHref(link: DashboardLink): string | null {
  switch (link.type) {
    case 'customer':
      return customerHref(link.customerId);
    case 'proposal':
      return proposalHref(link.proposalId);
    case 'mail':
      return mailHref(link.companyId);
    case 'task':
      return `#/tasks?task=${encodeURIComponent(link.taskId)}`;
    case 'company':
      return null; // opens the company drawer on Ana Sayfa
  }
}

/** A row target: a route link, or a button opening the company drawer. */
export function DashLink({ link, onOpenCompany, className, label, children }: { link: DashboardLink; onOpenCompany: (id: string) => void; className?: string; label?: string; children: ReactNode }) {
  const href = linkHref(link);
  if (href)
    return (
      <a className={className} href={href} aria-label={label}>
        {children}
      </a>
    );
  return (
    <button type="button" className={className} aria-label={label} onClick={() => onOpenCompany((link as { companyId: string }).companyId)}>
      {children}
    </button>
  );
}


/** "3 gün gecikti", "9 gündür bekliyor", "bugün 14:00"… */
export function ageLabel(a: AttentionItem): string {
  const d = a.ageDays;
  switch (a.kind) {
    case 'next_action_overdue':
    case 'onboarding_overdue':
    case 'follow_up_due':
      return d ? `${d} gün gecikti` : 'bugün';
    case 'meeting_no_outcome':
      return d ? `${d} gün önce` : 'bugün';
    case 'proposal_waiting':
      return `${d ?? 0} gündür bekliyor`;
    case 'access_problem':
      return d ? `${d} gündür` : 'bugün';
    case 'task_overdue':
      return d ? `${d} gün gecikti` : 'gecikti';
    case 'task_today':
    case 'onboarding_today':
      return 'bugün';
    case 'meeting_today':
      return a.at ? `bugün ${formatTime(new Date(a.at))}` : 'bugün';
    case 'next_action_today':
      return 'bugün';
    default:
      return a.at ? formatShortDate(new Date(a.at)) : '';
  }
}
