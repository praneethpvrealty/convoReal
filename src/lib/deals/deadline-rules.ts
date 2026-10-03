export type DealDeadlineKind = 'milestone' | 'payment' | 'expected_close';
export type DealDeadlineUrgency = 'overdue' | 'today' | 'soon';

/** How far ahead Focus and Today look. */
export const DEAL_DEADLINE_HORIZON_DAYS = 14;

/** How far ahead the agent's task digest reminds. Shorter than the
 *  screens: the digest repeats up to three times a day, and a date a
 *  fortnight out repeated forty times is a reminder nobody reads. */
export const DEAL_DEADLINE_REMINDER_DAYS = 3;

export const DEAL_DEADLINE_URGENCY_LABELS: Record<DealDeadlineUrgency, string> =
  {
    overdue: 'Overdue',
    today: 'Due today',
    soon: 'Due soon',
  };

export interface DealDeadline {
  dealId: string;
  kind: DealDeadlineKind;
  milestoneId: string | null;
  /** The milestone's title, or "Expected close". */
  title: string;
  /** Buyer and property, as the Records index heads its rows. */
  subject: string;
  dueDate: string;
  /** Negative when overdue, zero on the day. */
  daysLeft: number;
  urgency: DealDeadlineUrgency;
  /** profiles.id the deal is assigned to, and the auth user who opened
   *  it — the pair deadlinesForAgent reads, carried so a calendar
   *  filtered to one member keeps that member's deal dates. */
  assignedTo: string | null;
  ownerUserId: string | null;
}

export interface DealDeadlineSummary {
  total: number;
  overdue: number;
  dueToday: number;
  soon: number;
}

const DAY_MS = 24 * 3_600_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date, as YYYY-MM-DD, in a time zone — the caller's own
 *  by default. The database never guesses the day: every read of the
 *  deadline functions passes the day it means. */
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

/** Whole days from one date-only string to another, ignoring clocks and
 *  daylight saving: both are read as UTC midnight. */
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

export function deadlineUrgency(daysLeft: number): DealDeadlineUrgency {
  if (daysLeft < 0) return 'overdue';
  if (daysLeft === 0) return 'today';
  return 'soon';
}

/** "Overdue by 3 days", "Due today", "Due tomorrow", "Due in 5 days". */
export function deadlineLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const n = -daysLeft;
    return `Overdue by ${n} day${n === 1 ? '' : 's'}`;
  }
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return 'Due tomorrow';
  return `Due in ${daysLeft} days`;
}

const KIND_ORDER: Record<DealDeadlineKind, number> = {
  milestone: 0,
  payment: 1,
  expected_close: 2,
};

/** Soonest first; on the same day a milestone outranks a payment,
 *  which outranks the deal's expected close: the things to do come
 *  before the date they add up to. */
export function sortDeadlines<
  T extends Pick<DealDeadline, 'dueDate' | 'kind' | 'title'>,
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.title.localeCompare(b.title)
  );
}

export function summarizeDeadlines(
  items: readonly Pick<DealDeadline, 'urgency'>[]
): DealDeadlineSummary {
  return {
    total: items.length,
    overdue: items.filter((d) => d.urgency === 'overdue').length,
    dueToday: items.filter((d) => d.urgency === 'today').length,
    soon: items.filter((d) => d.urgency === 'soon').length,
  };
}

export interface DealDeadlineGroup {
  dealId: string;
  subject: string;
  titles: string[];
  dueDate: string;
  daysLeft: number;
  urgency: DealDeadlineUrgency;
  items: DealDeadline[];
}

export function groupDeadlinesByDeal(
  items: readonly DealDeadline[]
): DealDeadlineGroup[] {
  const groups = new Map<string, DealDeadlineGroup>();
  for (const d of sortDeadlines(items)) {
    const group = groups.get(d.dealId);
    if (!group) {
      groups.set(d.dealId, {
        dealId: d.dealId,
        subject: d.subject,
        titles: [d.title],
        dueDate: d.dueDate,
        daysLeft: d.daysLeft,
        urgency: d.urgency,
        items: [d],
      });
      continue;
    }
    group.items.push(d);
    if (!group.titles.includes(d.title)) group.titles.push(d.title);
  }
  return [...groups.values()];
}
