const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function parse(iso: string): Date | null {
  const dateOnly = DATE_ONLY.exec(iso);
  const date = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      )
    : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayLabel(date: Date, now: Date): string {
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear()
    ? day
    : `${day} ${date.getFullYear()}`;
}

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
}

function localFields(date: Date): number {
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

function wholeDaysBetween(later: Date, earlier: Date): number {
  const days = Math.round((startOfDay(later) - startOfDay(earlier)) / DAY_MS);
  const shifted = new Date(later);
  shifted.setDate(later.getDate() - days);
  return localFields(shifted) < localFields(earlier) ? days - 1 : days;
}

export function formatDate(iso: string, now = new Date()): string {
  const date = parse(iso);
  if (!date) return '';
  return dayLabel(date, now);
}

export function formatDateTime(iso: string, now = new Date()): string {
  const date = parse(iso);
  if (!date) return '';
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${dayLabel(date, now)}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
}

export function formatRelative(iso: string, now = new Date()): string {
  const date = parse(iso);
  if (!date) return '';
  const elapsed = now.getTime() - date.getTime();
  const minutes = Math.trunc(elapsed / MINUTE_MS);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.trunc(elapsed / HOUR_MS);
  if (hours < 24) return `${hours}h ago`;
  const days = wholeDaysBetween(now, date);
  if (days === 1) return 'yesterday';
  if (days <= 30) return `${days} days ago`;
  return formatDate(iso, now);
}
