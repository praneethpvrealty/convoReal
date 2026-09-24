/**
 * Deal deadlines: the dates a closing record carries, read through one
 * rule so Focus, Today and the agent task digest agree about what is
 * due.
 *
 * A deadline is either a milestone's target date or the deal's
 * expected close date. Both are set on the record; the SQL functions
 * in migration 20260924103000 decide which are due, and this module
 * only turns "today" and a due date into a label. Nothing here moves a
 * stage, completes a milestone or writes a row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { transactionTitle } from './index-row';

export type DealDeadlineKind = 'milestone' | 'expected_close';
export type DealDeadlineUrgency = 'overdue' | 'today' | 'soon';

/** How far ahead Focus and Today look. */
export const DEAL_DEADLINE_HORIZON_DAYS = 14;

/** How far ahead the agent's task digest reminds. Shorter than the
 *  screens: the digest repeats up to three times a day, and a date a
 *  fortnight out repeated forty times is a reminder nobody reads. */
export const DEAL_DEADLINE_REMINDER_DAYS = 3;

/** Mirrored in mobile/lib/focus.ts; guarded by mobile-parity.test.ts. */
export const DEAL_DEADLINE_URGENCY_LABELS: Record<DealDeadlineUrgency, string> =
  {
    overdue: 'Overdue',
    today: 'Due today',
    soon: 'Due soon',
  };

/** One row of deal_deadlines / deal_deadlines_for_account. */
export interface DealDeadlineRow {
  deal_id: string;
  deal_title: string;
  contact_name: string | null;
  property_title: string | null;
  property_unit_no: string | null;
  kind: DealDeadlineKind;
  milestone_id: string | null;
  title: string;
  due_date: string;
  assigned_to: string | null;
  owner_user_id: string | null;
}

/** Mirrored in mobile/lib/focus.ts as FocusDeadline; guarded by
 *  mobile-parity.test.ts. */
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

/** "Overdue by 3 days", "Due today", "Due tomorrow", "Due in 5 days".
 *  Mirrored in mobile/lib/focus.ts; guarded by mobile-parity.test.ts. */
export function deadlineLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const n = -daysLeft;
    return `Overdue by ${n} day${n === 1 ? '' : 's'}`;
  }
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return 'Due tomorrow';
  return `Due in ${daysLeft} days`;
}

export function toDealDeadline(
  row: DealDeadlineRow,
  today: string
): DealDeadline {
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
  };
}

/** Soonest first; on the same day a milestone outranks the deal's
 *  expected close, since the milestone is the thing to do. */
export function sortDeadlines<
  T extends Pick<DealDeadline, 'dueDate' | 'kind' | 'title'>,
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      (a.kind === b.kind ? 0 : a.kind === 'milestone' ? -1 : 1) ||
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

/** The deadlines one agent is reminded about: deals assigned to them,
 *  plus unassigned deals they opened — the same rule the digest applies
 *  to to-dos. `profileId` is what deals.assigned_to references. */
export function deadlinesForAgent<
  T extends Pick<DealDeadlineRow, 'assigned_to' | 'owner_user_id'>,
>(rows: readonly T[], agent: { profileId: string; userId: string }): T[] {
  return rows.filter(
    (r) =>
      r.assigned_to === agent.profileId ||
      (r.assigned_to === null && r.owner_user_id === agent.userId)
  );
}

/** Member read, through the guarded function. Web Today calls this
 *  with the browser client; /api/focus with the caller's server
 *  client. */
export async function loadDealDeadlines(
  db: SupabaseClient,
  accountId: string,
  today: string,
  horizonDays: number = DEAL_DEADLINE_HORIZON_DAYS
): Promise<DealDeadline[]> {
  const { data, error } = await db.rpc('deal_deadlines', {
    target_account_id: accountId,
    p_today: today,
    p_horizon_days: horizonDays,
  });
  if (error) throw new Error(error.message);
  return sortDeadlines(
    ((data ?? []) as DealDeadlineRow[]).map((row) => toDealDeadline(row, today))
  );
}

/** Service-role read for the digest, which has no auth.uid() and so
 *  gets nothing from the guarded function. Returns the raw rows: the
 *  caller still has to pick the agent's own. */
export async function loadDealDeadlineRowsForAccount(
  admin: SupabaseClient,
  accountId: string,
  today: string,
  horizonDays: number
): Promise<DealDeadlineRow[]> {
  const { data, error } = await admin.rpc('deal_deadlines_for_account', {
    p_account_id: accountId,
    p_today: today,
    p_horizon_days: horizonDays,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as DealDeadlineRow[];
}
