import { CalendarDays } from 'lucide-react';
import { formatLongDate } from '../../../lib/date';

export function HomeHeader({ now }: { now: Date }) {
  return (
    <header className="home-header">
      <div>
        <h1 className="home-header__title">Günaydın Berk 👋</h1>
        <p className="home-header__subtitle">Bugün KITE Growth'ta neler oluyor, hızlıca bakalım.</p>
      </div>
      <p className="home-header__date">
        <CalendarDays size={16} aria-hidden="true" />
        <time dateTime={now.toISOString().slice(0, 10)}>{formatLongDate(now)}</time>
      </p>
    </header>
  );
}
