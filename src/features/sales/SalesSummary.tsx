// "Satış" card in the company drawer overview (Phase 8): stage, next action, meetings and the
// current proposal at a glance. Details live in the Görüşmeler and Teklifler tabs.
import { CalendarCheck, FileText, Flag } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { SalesStatusBadge } from '../../components/sales/SalesStatusBadge';
import type { Company } from '../../domain/company';
import { MEETING_TYPE_LABELS, PROPOSAL_STATUS_LABELS } from '../../domain/sales';
import { formatDateTime, formatDue } from '../../lib/date';
import { useSales } from '../../state/sales/SalesProvider';
import { PROPOSAL_TONE, totalsLabel } from './salesView';

export function SalesSummary({ company }: { company: Company }) {
  const { meetingsFor, proposalsFor } = useSales();
  const meetings = meetingsFor(company.id);
  const proposals = proposalsFor(company.id);
  const relevant = ['replied', 'meeting', 'proposal', 'awaiting_decision', 'client', 'lost'].includes(company.status);
  if (!relevant && meetings.length === 0 && proposals.length === 0) return null;
  const nowIso = new Date().toISOString();
  const next = meetings.filter((m) => m.status === 'planned' && m.scheduledAt >= nowIso).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  const last = meetings.filter((m) => m.status === 'completed')[0];
  const active = proposals.find((p) => ['draft', 'ready', 'sent'].includes(p.status)) ?? proposals[0];

  return (
    <section className="comm-summary sales-summary" aria-labelledby="sales-summary-title">
      <div className="comm-summary__head">
        <h3 id="sales-summary-title" className="comm-summary__title">
          Satış
        </h3>
        <SalesStatusBadge status={company.status} />
      </div>
      <p className="comm-summary__row">
        <Flag size={14} aria-hidden="true" />
        {company.nextAction ? (
          <span>
            {company.nextAction.label}
            {company.nextAction.dueAt && <span className="comm-summary__meta"> · {formatDue(new Date(company.nextAction.dueAt))}</span>}
          </span>
        ) : (
          <span className="comm-summary__meta">Sonraki adım belirlenmedi</span>
        )}
      </p>
      <p className="comm-summary__row">
        <CalendarCheck size={14} aria-hidden="true" />
        {next ? (
          <span>
            Planlı görüşme: {formatDateTime(new Date(next.scheduledAt))} · {MEETING_TYPE_LABELS[next.type]}
          </span>
        ) : last ? (
          <span>
            Son görüşme: {formatDateTime(new Date(last.scheduledAt))}
            {last.outcome && <span className="comm-summary__meta"> · {last.outcome.slice(0, 80)}</span>}
          </span>
        ) : (
          <span className="comm-summary__meta">Henüz görüşme yok</span>
        )}
      </p>
      <p className="comm-summary__row">
        <FileText size={14} aria-hidden="true" />
        {active ? (
          <>
            <span>
              {active.title}
              <span className="comm-summary__meta"> · {totalsLabel(active)}</span>
            </span>
            <Badge tone={PROPOSAL_TONE[active.status]}>{PROPOSAL_STATUS_LABELS[active.status]}</Badge>
          </>
        ) : (
          <span className="comm-summary__meta">Henüz teklif yok</span>
        )}
      </p>
    </section>
  );
}
