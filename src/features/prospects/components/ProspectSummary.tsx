import { SALES_STATUS, type SalesStatus } from '../../../domain/salesStatus';

// Operational counts only. "Yeni Bulunan" / "Müşteri Oldu" read more naturally here than the badge labels.
const SUMMARY_ITEMS: { status: SalesStatus; label: string }[] = [
  { status: 'found', label: 'Yeni Bulunan' },
  { status: 'researched', label: SALES_STATUS.researched.label },
  { status: 'first_contact', label: SALES_STATUS.first_contact.label },
  { status: 'replied', label: SALES_STATUS.replied.label },
  { status: 'meeting', label: SALES_STATUS.meeting.label },
  { status: 'proposal', label: SALES_STATUS.proposal.label },
  { status: 'client', label: SALES_STATUS.client.stageLabel },
];

interface ProspectSummaryProps {
  total: number;
  counts: Record<SalesStatus, number>;
  /** Currently filtered status, if any; the matching item shows as pressed. */
  activeStatus: SalesStatus | null;
  onSelectStatus: (status: SalesStatus | null) => void;
}

/** Each count doubles as a quick status filter. Clicking the active one (or the total) clears it. */
export function ProspectSummary({ total, counts, activeStatus, onSelectStatus }: ProspectSummaryProps) {
  return (
    <section aria-label="Durum özeti">
      <ul className="prospect-summary">
        <li>
          <button
            type="button"
            className="prospect-summary__item prospect-summary__item--total"
            aria-pressed={activeStatus === null}
            onClick={() => onSelectStatus(null)}
          >
            <span className="prospect-summary__label">Toplam Şirket</span>
            <span className="prospect-summary__value">{total}</span>
          </button>
        </li>
        {SUMMARY_ITEMS.map((item) => {
          const active = activeStatus === item.status;
          return (
            <li key={item.status}>
              <button
                type="button"
                className="prospect-summary__item"
                aria-pressed={active}
                onClick={() => onSelectStatus(active ? null : item.status)}
              >
                <span className="prospect-summary__label">{item.label}</span>
                <span className="prospect-summary__value">{counts[item.status]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
