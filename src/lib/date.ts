const LOCALE = 'tr-TR';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** ISO string for today (or `dayOffset` days away) at the given local time. */
export function relativeIso(dayOffset: number, hours: number, minutes = 0, now = new Date()): string {
  const d = startOfDay(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

export function formatLongDate(d: Date): string {
  return d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

export function formatMonthYear(d: Date): string {
  return d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

/** Short Turkish label for a due date relative to now: "Bugün 14:00", "Yarın 10:00", "3 gün gecikti". */
export function formatDue(due: Date, now = new Date()): string {
  const diff = dayDiff(now, due);
  const time = formatTime(due);
  if (diff === 0) return due < now ? `Bugün ${time} · geçti` : `Bugün ${time}`;
  if (diff === 1) return `Yarın ${time}`;
  if (diff === -1) return '1 gün gecikti';
  if (diff < -1) return `${-diff} gün gecikti`;
  if (diff < 7) return due.toLocaleDateString(LOCALE, { weekday: 'long' }) + ` ${time}`;
  return due.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

export function formatShortDate(d: Date): string {
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(d: Date): string {
  return `${formatShortDate(d)}, ${formatTime(d)}`;
}

/** "Bugün", "Dün", "5 gün önce", or a short date for anything older than a month. */
export function formatRelativePast(d: Date, now = new Date()): string {
  const diff = dayDiff(d, now);
  if (diff <= 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  if (diff < 30) return `${diff} gün önce`;
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

/** ISO string -> "YYYY-MM-DD" in local time, for <input type="date">. */
export function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" -> ISO string at local noon (avoids timezone day shifts), or null when empty. */
export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}
