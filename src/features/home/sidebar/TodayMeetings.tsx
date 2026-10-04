import { MapPin, Video } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import type { Meeting } from '../../../lib/types';
import { formatTime, isSameDay } from '../../../lib/date';

const ONLINE = ['Google Meet', 'Zoom'];

export function TodayMeetings({ now, meetings }: { now: Date; meetings: Meeting[] }) {
  const today = meetings
    .filter((m) => isSameDay(new Date(m.start), now))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const isPast = (m: Meeting) => new Date(m.start).getTime() + m.durationMin * 60_000 < now.getTime();
  const nextId = today.find((m) => !isPast(m))?.id;

  return (
    <Card title="Bugünün Toplantıları" subtitle={today.length ? `${today.length} toplantı` : undefined} flush>
      {today.length === 0 ? (
        <p className="empty-state">Bugün toplantı yok.</p>
      ) : (
        <ul className="meetings">
          {today.map((m) => {
            const LocationIcon = ONLINE.includes(m.location) ? Video : MapPin;
            return (
              <li key={m.id} className={isPast(m) ? 'meeting meeting--past' : 'meeting'}>
                <div className="meeting__time">
                  <span>{formatTime(new Date(m.start))}</span>
                  <span className="meeting__duration">{m.durationMin} dk</span>
                </div>
                <div className="meeting__body">
                  <p className="meeting__title">
                    {m.company}
                    {m.id === nextId && <Badge tone="accent">Sıradaki</Badge>}
                  </p>
                  <p className="meeting__meta">
                    {m.title} · <LocationIcon size={12} aria-hidden="true" /> {m.location}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
