// Compact mail communication summary for the prospect drawer (Phase 6). The full conversation
// lives in Mail & Takip; this only shows what was sent, to whom, and whether a reply came.
import { MailCheck, MessageSquareReply } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import type { Company } from '../../../domain/company';
import { OUTBOUND_STATUS_LABELS } from '../../../domain/outreach';
import { formatDateTime } from '../../../lib/date';
import { useOutreach } from '../../../state/outreach/OutreachProvider';
import { mailHref } from '../../mail/routes';

const TONE = { sending: 'info', sent: 'success', failed: 'danger', ambiguous: 'warning' } as const;

export function CommunicationSummary({ company }: { company: Company }) {
  const { sendsFor, messages } = useOutreach();
  const sends = sendsFor(company.id);
  if (sends.length === 0) return null;
  const latest = sends[0];
  const replies = messages.filter((m) => m.companyId === company.id && m.direction === 'inbound').sort((a, b) => b.messageAt.localeCompare(a.messageAt));
  const lastReply = replies[0];

  return (
    <section className="comm-summary" aria-labelledby="comm-summary-title">
      <div className="comm-summary__head">
        <h3 id="comm-summary-title" className="comm-summary__title">
          İletişim
        </h3>
        <a className="link-button comm-summary__link" href={mailHref(company.id)}>
          Mail &amp; Takip'te Aç
        </a>
      </div>
      <p className="comm-summary__row">
        <MailCheck size={14} aria-hidden="true" />
        <span>
          <strong>{latest.subject}</strong>
          <span className="comm-summary__meta">
            {' '}
            · {latest.recipientEmail} · {formatDateTime(new Date(latest.sentAt ?? latest.attemptedAt))}
          </span>
        </span>
        <Badge tone={TONE[latest.status]}>{OUTBOUND_STATUS_LABELS[latest.status]}</Badge>
      </p>
      <p className="comm-summary__row">
        <MessageSquareReply size={14} aria-hidden="true" />
        {lastReply ? (
          <span>
            {replies.length} yanıt · son: {lastReply.fromName ?? lastReply.fromEmail}
            <span className="comm-summary__meta"> · {formatDateTime(new Date(lastReply.messageAt))}</span>
          </span>
        ) : (
          <span className="comm-summary__meta">Henüz yanıt yok</span>
        )}
      </p>
    </section>
  );
}
