// Display helpers for follow ups (Phase 7): tones and short Turkish descriptions.
import type { BadgeTone } from '../../components/ui/Badge';
import { currentStepOf, stepLabel, type FollowUpEffectiveStatus, type FollowUpSequenceView, type FollowUpStepStatus } from '../../domain/followUp';
import { formatDue, formatShortDate } from '../../lib/date';

export const FOLLOW_UP_TONE: Record<FollowUpEffectiveStatus, BadgeTone> = {
  active: 'info',
  paused: 'warning',
  blocked: 'danger',
  completed_replied: 'success',
  completed_no_reply: 'neutral',
  stopped: 'neutral',
};

export const STEP_TONE: Record<FollowUpStepStatus, BadgeTone> = {
  pending: 'neutral',
  scheduled: 'info',
  prepared: 'warning',
  approved: 'success',
  sent: 'success',
  skipped: 'neutral',
  cancelled: 'neutral',
};

/** "2. Takip · 14 Eki 2026" style summary of what comes next. */
export function nextFollowUpText(seq: FollowUpSequenceView, now: Date): string {
  const step = currentStepOf(seq);
  if (!step || !step.dueAt) return '—';
  return `${stepLabel(step.stepNumber)} · ${seq.isDue ? 'zamanı geldi' : formatDue(new Date(step.dueAt), now)}`;
}

export const shortDate = (iso: string | null) => (iso ? formatShortDate(new Date(iso)) : '—');
