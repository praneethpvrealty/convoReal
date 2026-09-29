/**
 * Deal dates on the calendar.
 *
 * A deal's dated commitments — an open milestone's target date, an
 * unpaid payment tranche's due date and the expected close date — are
 * decided by the deal_deadlines SQL rule (src/lib/deals/deadlines.ts,
 * TXW-020). The calendar reads that rule and pins each row on its day;
 * this module only decides how far ahead to read, which rows fall in
 * the visible range and how they are keyed and labelled. Nothing here
 * writes a row: a deal date lives on the deal record, and the calendar
 * links back to it.
 *
 * Mirrored in mobile/lib/deal-calendar.ts; guarded by
 * src/lib/mobile-parity.test.ts.
 */

import {
  daysBetween,
  sortDeadlines,
  type DealDeadline,
  type DealDeadlineKind,
} from '@/lib/deals/deadlines';

export const DEAL_DATE_KIND_LABELS: Record<DealDeadlineKind, string> = {
  milestone: 'Milestone',
  payment: 'Payment due',
  expected_close: 'Expected close',
};

/** The calendar reads at least a year ahead in one query, so paging
 *  through months never refetches; a range further out widens it. */
export const DEAL_DATE_MIN_HORIZON_DAYS = 365;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function dealDateHorizonDays(today: string, rangeEnd: string): number {
  return Math.max(DEAL_DATE_MIN_HORIZON_DAYS, daysBetween(today, rangeEnd));
}

/** YYYY-MM-DD of a local calendar day. */
export function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local Date for a date-only string, at midnight, so a deal date
 *  lands on the same grid cell whatever the browser's offset. */
export function dealDateLocalDay(dueDate: string): Date {
  return new Date(
    Number(dueDate.slice(0, 4)),
    Number(dueDate.slice(5, 7)) - 1,
    Number(dueDate.slice(8, 10))
  );
}

export function dealDatesInRange<
  T extends Pick<DealDeadline, 'dueDate' | 'kind' | 'title'>,
>(items: readonly T[], from: string, to: string): T[] {
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to) || from > to) return [];
  return sortDeadlines(
    items.filter((d) => d.dueDate >= from && d.dueDate <= to)
  );
}

export function groupDealDatesByDate<
  T extends Pick<DealDeadline, 'dueDate' | 'kind' | 'title'>,
>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const d of sortDeadlines(items)) {
    const list = map.get(d.dueDate);
    if (list) list.push(d);
    else map.set(d.dueDate, [d]);
  }
  return map;
}

/** One row per milestone or tranche, one per deal for the expected
 *  close: the same identity the Today page keys its rows by. */
export function dealDateKey(
  d: Pick<DealDeadline, 'dealId' | 'milestoneId' | 'kind'>
): string {
  return `${d.dealId}:${d.milestoneId ?? d.kind}`;
}

export function dealDateHref(dealId: string): string {
  return `/deals/${dealId}`;
}
