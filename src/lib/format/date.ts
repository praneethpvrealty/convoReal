import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isValid,
} from 'date-fns';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(iso: string): Date | null {
  const dateOnly = DATE_ONLY.exec(iso);
  const date = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      )
    : new Date(iso);
  return isValid(date) ? date : null;
}

export function formatDate(iso: string, now = new Date()): string {
  const date = parse(iso);
  if (!date) return '';
  return format(
    date,
    date.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yyyy'
  );
}

export function formatDateTime(iso: string, now = new Date()): string {
  const date = parse(iso);
  if (!date) return '';
  return format(
    date,
    date.getFullYear() === now.getFullYear()
      ? 'd MMM, h:mm aaa'
      : 'd MMM yyyy, h:mm aaa'
  );
}

export function formatRelative(iso: string, now = new Date()): string {
  const date = parse(iso);
  if (!date) return '';
  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = differenceInHours(now, date);
  if (hours < 24) return `${hours}h ago`;
  const days = differenceInDays(now, date);
  if (days === 1) return 'yesterday';
  if (days <= 30) return `${days} days ago`;
  return formatDate(iso, now);
}
