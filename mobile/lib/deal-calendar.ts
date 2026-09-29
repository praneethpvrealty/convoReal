/**
 * Deal dates on the calendar — hand-ported mirror of
 * src/lib/calendar/deal-dates.ts and the parts of
 * src/lib/deals/deadlines.ts the calendar needs. Guarded by
 * src/lib/mobile-parity.test.ts; edit both together.
 *
 * The rows come from the deal_deadlines SQL rule (TXW-020), read with
 * the member client in the calendar screen. Nothing here writes a row.
 */

import { transactionTitle } from '@/lib/deal-workspace';

export type DealDateKind = 'milestone' | 'payment' | 'expected_close';
export type DealDateUrgency = 'overdue' | 'today' | 'soon';

/** Mirrored from src/lib/calendar/deal-dates.ts (DEAL_DATE_KIND_LABELS). */
export const DEAL_DATE_KIND_LABELS: Record<DealDateKind, string> = {
  milestone: 'Milestone',
  payment: 'Payment due',
  expected_close: 'Expected close',
};

/** Mirrored from src/lib/calendar/deal-dates.ts (DEAL_DATE_HORIZON_DAYS):
 *  every open deal date, however far out, in one paged read. */
export const DEAL_DATE_HORIZON_DAYS = 36_525;

/** Mirrored from src/lib/deals/deadlines.ts (DEAL_DEADLINE_PAGE_SIZE,
 *  DEAL_DEADLINE_PAGE_ORDER): PostgREST answers at most its max-rows
 *  per request, so a year of deal dates is read page by page in a
 *  pinned order. */
export const DEAL_DATE_PAGE_SIZE = 500;

export const DEAL_DATE_PAGE_ORDER = [
  'due_date',
  'deal_id',
  'kind',
  'milestone_id',
] as const;

/** Mirrored from src/lib/deals/deadlines.ts (DealDeadlineRow). */
export interface DealDateRow {
  deal_id: string;
  deal_title: string;
  contact_name: string | null;
  property_title: string | null;
  property_unit_no: string | null;
  kind: DealDateKind;
  milestone_id: string | null;
  title: string;
  due_date: string;
  assigned_to: string | null;
  owner_user_id: string | null;
}

/** Mirrored from src/lib/deals/deadlines.ts (DealDeadline). */
export interface DealDate {
  dealId: string;
  kind: DealDateKind;
  milestoneId: string | null;
  title: string;
  subject: string;
  dueDate: string;
  daysLeft: number;
  urgency: DealDateUrgency;
  assignedTo: string | null;
  ownerUserId: string | null;
}

const DAY_MS = 24 * 3_600_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Mirrored from src/lib/deals/deadlines.ts (todayDateKey). */
export function todayDateKey(
  now: Date = new Date(),
  timeZone?: string
): string {
  return now.toLocaleDateString('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** Mirrored from src/lib/deals/deadlines.ts (daysBetween). */
export function daysBetween(from: string, to: string): number {
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) return 0;
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10))
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10))
  );
  return Math.round((b - a) / DAY_MS);
}

export function deadlineUrgency(daysLeft: number): DealDateUrgency {
  if (daysLeft < 0) return 'overdue';
  if (daysLeft === 0) return 'today';
  return 'soon';
}

/** Mirrored from src/lib/deals/deadlines.ts (toDealDeadline). */
export function toDealDate(row: DealDateRow, today: string): DealDate {
  const daysLeft = daysBetween(today, row.due_date);
  return {
    dealId: row.deal_id,
    kind: row.kind,
    milestoneId: row.milestone_id,
    title: row.title,
    subject: transactionTitle({
      title: row.deal_title,
      contact_name: row.contact_name,
      property_title: row.property_title,
      property_unit_no: row.property_unit_no,
    }),
    dueDate: row.due_date,
    daysLeft,
    urgency: deadlineUrgency(daysLeft),
    assignedTo: row.assigned_to,
    ownerUserId: row.owner_user_id,
  };
}

const KIND_ORDER: Record<DealDateKind, number> = {
  milestone: 0,
  payment: 1,
  expected_close: 2,
};

/** Mirrored from src/lib/deals/deadlines.ts (sortDeadlines). */
export function sortDealDates<
  T extends Pick<DealDate, 'dueDate' | 'kind' | 'title'>,
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.title.localeCompare(b.title)
  );
}

/** The day the calendar labels against. A tab kept mounted across
 *  midnight — backgrounded, resumed — must not keep yesterday's key, or
 *  a date due today reads "Due tomorrow" and Upcoming splits on the
 *  wrong day; the screen re-reads this on resume and on pull-to-refresh
 *  and keeps the same Date while the day has not changed. */
export function refreshedToday(current: Date, now: Date = new Date()): Date {
  return localDateKey(current) === localDateKey(now) ? current : now;
}

export interface CalendarDayState {
  today: Date;
  selected: Date;
  month: Date;
}

/** Rolls the calendar over midnight in one step: `today` moves to the
 *  new day, and the selection (with the month it sits in) follows only
 *  when it was resting on the old today — a day the agent chose
 *  deliberately stays where it is. Same object back when nothing
 *  changed, so callers can compare by identity. */
export function rollCalendarDay(
  state: CalendarDayState,
  now: Date = new Date()
): CalendarDayState {
  const today = refreshedToday(state.today, now);
  if (today === state.today) return state;
  const followed = localDateKey(state.selected) === localDateKey(state.today);
  return {
    today,
    selected: followed ? today : state.selected,
    month: followed
      ? new Date(today.getFullYear(), today.getMonth(), 1)
      : state.month,
  };
}

export function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dealDateLocalDay(dueDate: string): Date {
  return new Date(
    Number(dueDate.slice(0, 4)),
    Number(dueDate.slice(5, 7)) - 1,
    Number(dueDate.slice(8, 10))
  );
}

export function dealDatesInRange<
  T extends Pick<DealDate, 'dueDate' | 'kind' | 'title'>,
>(items: readonly T[], from: string, to: string): T[] {
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to) || from > to) return [];
  return sortDealDates(
    items.filter((d) => d.dueDate >= from && d.dueDate <= to)
  );
}

export function groupDealDatesByDate<
  T extends Pick<DealDate, 'dueDate' | 'kind' | 'title'>,
>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const d of sortDealDates(items)) {
    const list = map.get(d.dueDate);
    if (list) list.push(d);
    else map.set(d.dueDate, [d]);
  }
  return map;
}

export function dealDateKey(
  d: Pick<DealDate, 'dealId' | 'milestoneId' | 'kind'>
): string {
  return `${d.dealId}:${d.milestoneId ?? d.kind}`;
}

export function dealDateHref(dealId: string): `/(app)/deal/${string}` {
  return `/(app)/deal/${dealId}`;
}
