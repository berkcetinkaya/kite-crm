import { useMemo, useState } from 'react';
import { AlertCircle, Building2, Clock } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import type { ActionItem, Priority } from '../../../lib/types';
import { dayDiff, formatDue } from '../../../lib/date';

const priorityRank: Record<Priority, number> = { yuksek: 0, orta: 1, dusuk: 2 };
const priorityLabel: Record<Priority, string> = { yuksek: 'Yüksek', orta: 'Orta', dusuk: 'Düşük' };

type Filter = 'all' | 'overdue' | 'today';

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'overdue', label: 'Gecikmiş' },
  { id: 'today', label: 'Bugün' },
];

/** Overdue = due on an earlier day. Strong (red) styling is reserved for these. */
function isOverdue(item: ActionItem, now: Date): boolean {
  return !item.done && dayDiff(now, new Date(item.due)) < 0;
}

/** Due today but the time has passed: still actionable today, so only a softer (amber) hint. */
function isLateToday(item: ActionItem, now: Date): boolean {
  return !item.done && dayDiff(now, new Date(item.due)) === 0 && new Date(item.due) < now;
}

/** Open items first; within them overdue, then priority, then due time. Completed items sink to the bottom. */
function sortActions(items: ActionItem[], now: Date): ActionItem[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ao = isOverdue(a, now);
    const bo = isOverdue(b, now);
    if (ao !== bo) return ao ? -1 : 1;
    if (a.priority !== b.priority) return priorityRank[a.priority] - priorityRank[b.priority];
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });
}

interface TodayActionsProps {
  initialItems: ActionItem[];
  now: Date;
}

export function TodayActions({ initialItems, now }: TodayActionsProps) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<Filter>('all');

  const openCount = items.filter((i) => !i.done).length;
  const overdueCount = items.filter((i) => isOverdue(i, now)).length;

  const visible = useMemo(() => {
    const filtered = items.filter((i) => {
      if (filter === 'overdue') return isOverdue(i, now);
      if (filter === 'today') return dayDiff(now, new Date(i.due)) === 0;
      return true;
    });
    return sortActions(filtered, now);
  }, [items, filter, now]);

  const toggle = (id: string) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));

  return (
    <Card
      className="actions-card"
      title="Bugün ne yapmalıyım?"
      subtitle={
        <>
          {openCount} açık iş
          {overdueCount > 0 && <span className="actions-card__overdue-count"> · {overdueCount} gecikmiş</span>}
        </>
      }
      action={
        <div className="segmented" role="group" aria-label="Filtre">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? 'segmented__item segmented__item--active' : 'segmented__item'}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
      flush
    >
      {visible.length === 0 ? (
        <p className="empty-state">Bu filtrede iş yok. 🎉</p>
      ) : (
        <ul className="action-list">
          {visible.map((item) => {
            const overdue = isOverdue(item, now);
            const lateToday = isLateToday(item, now);
            const due = new Date(item.due);
            const className = [
              'action',
              overdue && 'action--overdue',
              lateToday && 'action--late',
              item.done && 'action--done',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <li key={item.id} className={className}>
                <label className="action__check">
                  <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
                  <span className="visually-hidden">Tamamlandı olarak işaretle: {item.title}</span>
                </label>
                <div className="action__body">
                  <p className="action__title">{item.title}</p>
                  <div className="action__meta">
                    <span className={`priority priority--${item.priority}`}>
                      <span className="priority__dot" aria-hidden="true" />
                      {priorityLabel[item.priority]}
                    </span>
                    <Badge>{item.category}</Badge>
                    {item.relatedTo && (
                      <span className="action__related">
                        <Building2 size={14} aria-hidden="true" />
                        {item.relatedTo}
                      </span>
                    )}
                  </div>
                </div>
                <time className="action__due" dateTime={item.due}>
                  {overdue || lateToday ? <AlertCircle size={14} aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
                  {formatDue(due, now)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
