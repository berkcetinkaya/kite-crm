import {
  ArrowRightLeft,
  Gauge,
  History,
  MailCheck,
  MessageSquareReply,
  PencilLine,
  PlusCircle,
  StickyNote,
  Target,
  UserPlus,
  UserRoundPen,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';
import type { Company, CompanyHistoryType } from '../../../domain/company';
import { formatDateTime } from '../../../lib/date';

const ICONS: Record<CompanyHistoryType, LucideIcon> = {
  created: PlusCircle,
  status_changed: ArrowRightLeft,
  score_updated: Gauge,
  details_updated: PencilLine,
  opportunities_updated: Target,
  note_added: StickyNote,
  contact_added: UserPlus,
  contact_updated: UserRoundPen,
  email_sent: MailCheck,
  reply_received: MessageSquareReply,
};

export function HistorySection({ company }: { company: Company }) {
  const entries = [...company.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (entries.length === 0) {
    return (
      <div className="detail-section">
        <EmptyState icon={History} title="Henüz geçmiş kaydı yok" description="Bu şirketteki değişiklikler burada listelenecek." />
      </div>
    );
  }

  return (
    <div className="detail-section">
      <ol className="timeline">
        {entries.map((e) => {
          const Icon = ICONS[e.type] ?? History;
          return (
            <li key={e.id} className="timeline__item">
              <span className="timeline__icon" aria-hidden="true">
                <Icon size={14} />
              </span>
              <div>
                <p className="timeline__text">{e.description}</p>
                <p className="timeline__meta">
                  {e.author} · <time dateTime={e.createdAt}>{formatDateTime(new Date(e.createdAt))}</time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
