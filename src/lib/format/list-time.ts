import { formatDate } from './date';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CLOCK_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
}

export function clockTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? date.toLocaleTimeString('en-IN', CLOCK_OPTIONS) : '';
}

export function listTime(
  iso: string | null | undefined,
  now = new Date()
): string {
  const date = parse(iso);
  if (!date) return '';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return clockTime(iso);
  if (days === 1) return 'Yesterday';
  if (days === -1) return 'Tomorrow';
  if (days > 1 && days < 7) return WEEKDAYS[date.getDay()];
  return formatDate(date.toISOString(), now);
}
