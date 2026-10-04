import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { Meeting } from '../../../lib/types';
import { formatMonthYear, isSameDay } from '../../../lib/date';

const weekdays = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];

/** 6×7 grid of dates for the month, Monday-first, padded with neighbouring months. */
function buildGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + i));
}

export function MiniCalendar({ now, meetings }: { now: Date; meetings: Meeting[] }) {
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const grid = useMemo(() => buildGrid(month), [month]);
  const meetingDays = useMemo(() => meetings.map((m) => new Date(m.start)), [meetings]);

  const shift = (delta: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <Card
      title={<span className="calendar__month">{formatMonthYear(month)}</span>}
      action={
        <div className="calendar__nav">
          <button type="button" className="icon-button" onClick={() => shift(-1)} aria-label="Önceki ay">
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="icon-button" onClick={() => shift(1)} aria-label="Sonraki ay">
            <ChevronRight size={16} />
          </button>
        </div>
      }
    >
      <div className="calendar" role="grid" aria-label={formatMonthYear(month)}>
        {weekdays.map((d) => (
          <span key={d} className="calendar__weekday" role="columnheader">
            {d}
          </span>
        ))}
        {grid.map((d) => {
          const outside = d.getMonth() !== month.getMonth();
          const today = isSameDay(d, now);
          const hasMeeting = meetingDays.some((m) => isSameDay(m, d));
          const className = [
            'calendar__day',
            outside && 'calendar__day--outside',
            today && 'calendar__day--today',
            hasMeeting && 'calendar__day--event',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <span
              key={d.toISOString()}
              className={className}
              role="gridcell"
              aria-current={today ? 'date' : undefined}
              aria-label={hasMeeting ? `${d.getDate()}, toplantı var` : undefined}
            >
              {d.getDate()}
            </span>
          );
        })}
      </div>
    </Card>
  );
}
