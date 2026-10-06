// Shared sales UI helpers (Phase 8): tones, date-time inputs and the explicit stage-move choice.
import { useId } from 'react';
import type { BadgeTone } from '../../components/ui/Badge';
import { SalesStatusOptions } from '../../components/sales/SalesStatusOptions';
import type { Company } from '../../domain/company';
import { formatMoney, proposalTotals, type MeetingStatus, type Proposal, type ProposalStatus } from '../../domain/sales';
import { SALES_STAGES, SALES_STATUS, type SalesStatus } from '../../domain/salesStatus';
import { useFollowUps } from '../../state/followUps/FollowUpsProvider';
import './sales.css';

export const PROPOSAL_TONE: Record<ProposalStatus, BadgeTone> = { draft: 'neutral', ready: 'info', sent: 'accent', accepted: 'success', rejected: 'danger', expired: 'warning' };
export const MEETING_TONE: Record<MeetingStatus, BadgeTone> = { planned: 'info', completed: 'success', cancelled: 'neutral' };

/** ISO → "YYYY-MM-DDTHH:mm" (local) for <input type="datetime-local">. */
export function toDateTimeInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Local "YYYY-MM-DDTHH:mm" → ISO (UTC), or null. */
export function fromDateTimeInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "₺45.000,00 tek seferlik · ₺32.000,00 / ay" (never one combined total). */
export function totalsLabel(p: Pick<Proposal, 'items' | 'currency'>): string {
  const t = proposalTotals(p.items);
  const parts = [t.oneTimeMinor ? `${formatMoney(t.oneTimeMinor, p.currency)} tek seferlik` : null, t.monthlyMinor ? `${formatMoney(t.monthlyMinor, p.currency)} / ay` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Tutar yok';
}

const stageIndex = (s: SalesStatus) => (SALES_STAGES as readonly string[]).indexOf(s);

/**
 * Explicit stage move offered with an action. Unticked by default: nothing moves unless Berk ticks
 * it. With `choose`, Berk can also pick another stage (e.g. after a rejection).
 */
export function StageMoveChoice({
  company,
  suggested,
  value,
  onChange,
  choose = false,
}: {
  company: Company;
  suggested: SalesStatus;
  value: SalesStatus | null;
  onChange: (v: SalesStatus | null) => void;
  choose?: boolean;
}) {
  const id = useId();
  const { sequenceFor } = useFollowUps();
  const seq = sequenceFor(company.id);
  const target = value ?? suggested;
  // Phase 7 rule: leaving İlk Temas stops an active follow-up plan for good.
  const stopsFollowUp = value !== null && (seq?.status === 'active' || seq?.status === 'paused') && stageIndex(target) > stageIndex('first_contact');
  if (company.status === suggested && !choose) return <p className="sales-hint">Şirket zaten {SALES_STATUS[suggested].label} aşamasında.</p>;
  return (
    <div className="stage-move">
      <label className="stage-move__check">
        <input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? target : null)} />
        <span>
          Şirketi <strong>{SALES_STATUS[target].label}</strong> aşamasına taşı <span className="sales-hint">(şu an: {SALES_STATUS[company.status].label})</span>
        </span>
      </label>
      {choose && value !== null && (
        <label className="field stage-move__select" htmlFor={id}>
          <span className="field__label">Aşama</span>
          <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as SalesStatus)}>
            <SalesStatusOptions />
          </select>
        </label>
      )}
      {stopsFollowUp && <p className="sales-hint sales-hint--warn">Bu şirketin aktif takip planı var; bu aşamaya geçince kalan takip mailleri iptal edilir.</p>}
    </div>
  );
}
