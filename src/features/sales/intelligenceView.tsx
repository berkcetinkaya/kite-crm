// Shared sales intelligence display (Phase 14): priority and momentum badges, the "Neden?" reason
// list and the recommended-action link. Used by Satış Süreci, the company drawer and Ana Sayfa.
// Recommendations are advisory: the link only opens the place where Berk does the step himself.
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { MOMENTUM_LABELS, priorityText, type MomentumState, type PriorityLevel, type RecommendedAction, type SalesInsight, type SalesLink } from '../../domain/salesIntelligence';
import { formatShortDate } from '../../lib/date';
import { proposalHref } from '../home/dashboardView';
import { mailHref } from '../mail/routes';

export type CompanySection = 'meetings' | 'proposals' | 'contacts';

export const PRIORITY_TONE: Record<PriorityLevel, BadgeTone> = { critical: 'danger', high: 'warning', medium: 'info', normal: 'neutral' };
export const MOMENTUM_TONE: Record<MomentumState, BadgeTone> = { progressing: 'success', waiting: 'neutral', cooling: 'warning', stuck: 'danger', not_started: 'neutral' };

export function PriorityBadge({ level }: { level: PriorityLevel }) {
  return <Badge tone={PRIORITY_TONE[level]}>{priorityText(level)}</Badge>;
}

export function MomentumBadge({ state }: { state: MomentumState }) {
  return <Badge tone={MOMENTUM_TONE[state]}>{MOMENTUM_LABELS[state]}</Badge>;
}

/** "Neden bu öncelikte?": the explicit reasons, no hidden score. */
export function Reasons({ insight, summary = 'Neden?' }: { insight: SalesInsight; summary?: string }) {
  const reasons = insight.priority?.reasons ?? [];
  const momentum = insight.momentum?.reasons ?? [];
  if (!reasons.length && !momentum.length) return null;
  return (
    <details className="si-reasons">
      <summary>{summary}</summary>
      <ul>
        {reasons.map((r) => (
          <li key={`p-${r}`}>{r}</li>
        ))}
        {insight.momentum && momentum.map((r) => <li key={`m-${r}`}>{`${MOMENTUM_LABELS[insight.momentum!.state]}: ${r}`}</li>)}
      </ul>
    </details>
  );
}

export function linkTarget(link: SalesLink): { href: string } | { companyId: string; section?: CompanySection } {
  switch (link.type) {
    case 'mail':
      return { href: mailHref(link.companyId) };
    case 'proposal':
      return { href: proposalHref(link.proposalId) };
    case 'company':
      return { companyId: link.companyId, section: link.section };
  }
}

/** "Önerilen: …" as a link (route) or a button (company drawer tab). Never executes anything. */
export function ActionLink({ action, onOpenCompany, compact = false, children }: { action: RecommendedAction; onOpenCompany: (companyId: string, section?: CompanySection) => void; compact?: boolean; children?: ReactNode }) {
  const t = linkTarget(action.link);
  const content = (
    <>
      {children ?? (compact ? action.label : `Önerilen: ${action.label}`)}
      <ArrowRight size={13} aria-hidden="true" />
    </>
  );
  if ('href' in t)
    return (
      <a className="si-action" href={t.href} title={action.detail ?? undefined}>
        {content}
      </a>
    );
  return (
    <button type="button" className="si-action" title={action.detail ?? undefined} onClick={() => onOpenCompany(t.companyId, t.section)}>
      {content}
    </button>
  );
}

/** The user's own next action, shown next to (never replaced by) the recommendation. */
export function PlannedLine({ planned }: { planned: SalesInsight['planned'] }) {
  if (!planned) return null;
  return (
    <p className="si-planned">
      Planlı: {planned.label}
      {planned.dueAt ? ` · ${formatShortDate(new Date(planned.dueAt))}` : ''}
    </p>
  );
}

export const activityText = (i: SalesInsight) => (i.lastActivity ? `${i.lastActivity.label} · ${i.lastActivity.days === 0 ? 'bugün' : `${i.lastActivity.days} gün önce`}` : '—');
