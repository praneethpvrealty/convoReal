/**
 * What the calendar reads, shared by web and mobile (CAL-025). Import-free
 * so the mobile app can load it through `@shared/`.
 *
 * Appointments are read per view, never as the account's whole history:
 * the grid views read the months around the one shown, the Agenda reads
 * every event from today on plus past events a page at a time, and a
 * deep-linked event is read by id. To-dos read every open one and the
 * done ones a page at a time.
 */

export const APPOINTMENT_COLUMNS =
  'id, account_id, user_id, assigned_to, remind_creator, title, description, agenda, minutes, outcome, event_type, source, transcript, start_time, end_time, location, status, contact_id, contact_ids, property_id, liaison_id, reschedule_requested_at, client_confirmed_at, archived_at, deal_id';

export const APPOINTMENT_SELECT = `${APPOINTMENT_COLUMNS}, contact:contacts(id, name, phone, name_tag), property:properties(id, title, location, sublocality), deal:deals(id, title)`;

export const TODO_COLUMNS =
  'id, title, description, due_date, priority, completed, contact_id, property_id, deal_id, created_at';

export const TODO_SELECT = `${TODO_COLUMNS}, contact:contacts(id, name, phone, name_tag), property:properties(id, title, location, sublocality)`;

export const CALENDAR_PAGE_SIZE = 500;
export const PAST_APPOINTMENTS_PAGE_SIZE = 100;
export const DONE_TODOS_PAGE_SIZE = 100;

export interface CalendarWindow {
  from: Date;
  to: Date;
}

/** The appointments a grid view anchored on `anchor` can show: the month
 *  before, the month itself and the month after, as [from, to). The
 *  six-week month grid, any week that touches the month and any day in
 *  it all fall inside, so paging within the month needs no new read. */
export function appointmentWindow(anchor: Date): CalendarWindow {
  return {
    from: new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1),
    to: new Date(anchor.getFullYear(), anchor.getMonth() + 2, 1),
  };
}

export function calendarWindowKey(window: CalendarWindow): string {
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}`;
  return `${key(window.from)}_${key(window.to)}`;
}

export function inCalendarWindow(
  startTime: string,
  window: CalendarWindow
): boolean {
  const at = new Date(startTime).getTime();
  return at >= window.from.getTime() && at < window.to.getTime();
}

export function startOfLocalDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Reads a query to its end in fixed pages, so a list longer than the
 *  API's row cap is never silently cut short. */
export async function loadAllPages<T>(
  loadPage: (from: number, to: number) => Promise<T[]>,
  pageSize = CALENDAR_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await loadPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/** The next page's offset for a list read newest-first in fixed pages,
 *  or undefined once a short page shows the end was reached. */
export function nextPageOffset(
  pages: readonly (readonly unknown[])[],
  pageSize: number
): number | undefined {
  const last = pages[pages.length - 1];
  if (!last || last.length < pageSize) return undefined;
  return pages.reduce((n, page) => n + page.length, 0);
}

/** Merges row lists read by different queries into one, first copy wins. */
export function mergeById<T extends { id: string }>(
  ...lists: readonly (readonly T[] | undefined)[]
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const list of lists) {
    for (const row of list ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}

interface PagedRows<T> {
  pages: T[][];
  pageParams: unknown[];
}

function isPagedRows<T>(data: unknown): data is PagedRows<T> {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { pages?: unknown }).pages)
  );
}

/** Applies one edit to a cached calendar read whatever its shape: a
 *  list, a paged list or a single row. Returning null from `patch`
 *  removes the row. Unknown shapes are returned untouched. */
export function patchCachedRows<T extends { id: string }>(
  data: unknown,
  patch: (row: T) => T | null
): unknown {
  const patchList = (rows: T[]) =>
    rows.flatMap((row) => {
      const next = patch(row);
      return next ? [next] : [];
    });
  if (Array.isArray(data)) return patchList(data as T[]);
  if (isPagedRows<T>(data)) {
    return { ...data, pages: data.pages.map(patchList) };
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { id?: unknown }).id === 'string'
  ) {
    return patch(data as T);
  }
  return data;
}
