// Ana Sayfa: one small follow up indicator (Phase 7). Counts come from the server's follow up queue;
// opening the page never generates or sends anything.
import { CalendarClock } from 'lucide-react';
import { MAIL_ROUTE } from '../../mail/routes';
import { useFollowUps } from '../../../state/followUps/FollowUpsProvider';

export function FollowUpIndicator() {
  const { overview } = useFollowUps();
  if (!overview) return null;
  const count = (g: string) => overview.sequences.filter((s) => s.queueGroup === g).length;
  const due = count('due');
  const waiting = count('prepared') + count('approved');
  const upcoming = count('upcoming');
  return (
    <a className="card fu-home" href={MAIL_ROUTE} aria-label={`Takip Bekleyenler: ${due + waiting}. Mail ve Takip'te aç`}>
      <span className="fu-home__icon" aria-hidden="true">
        <CalendarClock size={18} />
      </span>
      <span className="fu-home__main">
        <span className="fu-home__label">Takip Bekleyenler</span>
        <span className="fu-home__value">{due + waiting}</span>
      </span>
      <span className="fu-home__meta">
        {due} takip zamanı geldi · {waiting} taslak bekliyor · {upcoming} yaklaşan
        <span className="fu-home__link">Mail &amp; Takip’te aç</span>
      </span>
    </a>
  );
}
