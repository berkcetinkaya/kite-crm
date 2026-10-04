import { Badge, type BadgeTone } from '../ui/Badge';
import { SALES_STATUS, type SalesStatus } from '../../domain/salesStatus';

/** Shared visual treatment for sales statuses. Side states stay neutral except a lost deal. */
export const SALES_STATUS_TONE: Record<SalesStatus, BadgeTone> = {
  found: 'neutral',
  researched: 'info',
  first_contact: 'info',
  replied: 'accent',
  meeting: 'accent',
  proposal: 'warning',
  awaiting_decision: 'warning',
  client: 'success',
  disqualified: 'neutral',
  not_interested: 'neutral',
  later: 'neutral',
  lost: 'danger',
};

export function SalesStatusBadge({ status }: { status: SalesStatus }) {
  return (
    <Badge tone={SALES_STATUS_TONE[status]} dot>
      {SALES_STATUS[status].label}
    </Badge>
  );
}
