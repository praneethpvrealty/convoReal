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

import {
  DEAL_DEADLINE_HORIZON_DAYS,
  daysBetween,
  deadlineUrgency,
  sortDeadlines,
  type DealDeadline,
  type DealDeadlineKind,
} from './deadline-rules';
import { transactionTitle } from './index-row';

export * from './deadline-rules';

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
    assignedTo: row.assigned_to,
    ownerUserId: row.owner_user_id,
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

/** PostgREST answers one request with at most its max-rows setting
 *  (1,000 on Supabase) and says nothing about the rest. Focus and Today
 *  read two weeks and fit in one page; the calendar reads a year ahead
 *  (CAL-008), so every read pages until a short page comes back. The
 *  order is pinned on the request — PostgREST's own ORDER BY replaces
 *  the function's — so pages never overlap or skip. Mirrored in
 *  mobile/lib/deal-calendar.ts / the mobile calendar; guarded by
 *  mobile-parity.test.ts. */
export const DEAL_DEADLINE_PAGE_SIZE = 500;

export const DEAL_DEADLINE_PAGE_ORDER = [
  'due_date',
  'deal_id',
  'kind',
  'milestone_id',
] as const;

interface DeadlinePage {
  data: unknown;
  error: { message: string } | null;
}

interface DeadlineQuery extends PromiseLike<DeadlinePage> {
  order(column: string, options?: { ascending?: boolean }): DeadlineQuery;
  range(from: number, to: number): DeadlineQuery;
}

async function loadDeadlinePages(
  page: (from: number, to: number) => DeadlineQuery
): Promise<DealDeadlineRow[]> {
  const rows: DealDeadlineRow[] = [];
  for (let from = 0; ; from += DEAL_DEADLINE_PAGE_SIZE) {
    let query = page(from, from + DEAL_DEADLINE_PAGE_SIZE - 1);
    for (const column of DEAL_DEADLINE_PAGE_ORDER) {
      query = query.order(column, { ascending: true });
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as DealDeadlineRow[];
    rows.push(...batch);
    if (batch.length < DEAL_DEADLINE_PAGE_SIZE) return rows;
  }
}

/** Member read, through the guarded function. Web Today calls this
 *  with the browser client; /api/focus with the caller's server
 *  client; the web calendar with the browser client and a year's
 *  horizon. */
export async function loadDealDeadlines(
  db: SupabaseClient,
  accountId: string,
  today: string,
  horizonDays: number = DEAL_DEADLINE_HORIZON_DAYS
): Promise<DealDeadline[]> {
  const rows = await loadDeadlinePages((from, to) =>
    db
      .rpc('deal_deadlines', {
        target_account_id: accountId,
        p_today: today,
        p_horizon_days: horizonDays,
      })
      .range(from, to)
  );
  return sortDeadlines(rows.map((row) => toDealDeadline(row, today)));
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
  return loadDeadlinePages((from, to) =>
    admin
      .rpc('deal_deadlines_for_account', {
        p_account_id: accountId,
        p_today: today,
        p_horizon_days: horizonDays,
      })
      .range(from, to)
  );
}
