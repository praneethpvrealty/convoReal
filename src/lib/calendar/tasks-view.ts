/**
 * The Tasks list under the calendar (CAL-010): everything pinned on
 * the visible days — appointments and deal dates — in date order, with
 * the status changes an appointment row offers. To-dos stay in their
 * own lightweight list (CAL-009) and are never mixed in here.
 *
 * Mirrored in mobile/lib/calendar-tasks.ts; guarded by
 * src/lib/mobile-parity.test.ts.
 */

import { dealDateLocalDay, localDateKey } from './deal-dates';

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export interface AppointmentStatusAction {
  status: AppointmentStatus;
  label: string;
}

/** A scheduled event can be marked done or cancelled; a finished one
 *  can be reopened. Cancelling never deletes: the row stays on its day,
 *  struck through, so the day still shows what was planned. */
export function appointmentStatusActions(
  status: AppointmentStatus
): AppointmentStatusAction[] {
  if (status === 'scheduled') {
    return [
      { status: 'completed', label: 'Done' },
      { status: 'cancelled', label: 'Cancel' },
    ];
  }
  return [{ status: 'scheduled', label: 'Reopen' }];
}

export interface ArchivableAppointmentLike {
  id: string;
  status: AppointmentStatus;
  archived_at?: string | null;
}

export const ARCHIVE_BATCH_LIMIT = 500;

export function canArchiveAppointment(status: AppointmentStatus): boolean {
  return status !== 'scheduled';
}

export function isArchivedAppointment(
  appointment: ArchivableAppointmentLike
): boolean {
  return !!appointment.archived_at && canArchiveAppointment(appointment.status);
}

export function archivableAppointmentIds(
  appointments: readonly ArchivableAppointmentLike[]
): string[] {
  return appointments
    .filter((a) => canArchiveAppointment(a.status) && !isArchivedAppointment(a))
    .map((a) => a.id);
}

export function chunkIds(
  ids: readonly string[],
  size: number = ARCHIVE_BATCH_LIMIT
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size)
    chunks.push(ids.slice(i, i + size));
  return chunks;
}

export function withoutArchivedAppointments<
  A extends ArchivableAppointmentLike,
>(
  appointments: readonly A[],
  showArchived: boolean
): { visible: A[]; archivedCount: number } {
  const archivedCount = appointments.filter(isArchivedAppointment).length;
  return {
    visible: showArchived
      ? [...appointments]
      : appointments.filter((a) => !isArchivedAppointment(a)),
    archivedCount,
  };
}

export interface TaskAppointmentLike {
  id: string;
  start_time: string;
  status: AppointmentStatus;
}

export interface TaskDealDateLike {
  dealId: string;
  milestoneId: string | null;
  kind: 'milestone' | 'payment' | 'expected_close';
  dueDate: string;
}

export type CalendarTaskRow<
  A extends TaskAppointmentLike,
  D extends TaskDealDateLike,
> =
  | { kind: 'appointment'; at: number; dayKey: string; appointment: A }
  | { kind: 'deal'; at: number; dayKey: string; dealDate: D };

export interface CalendarTaskDay<
  A extends TaskAppointmentLike,
  D extends TaskDealDateLike,
> {
  dayKey: string;
  rows: CalendarTaskRow<A, D>[];
}

/** Every row pinned on a day from `from` to `to` (local YYYY-MM-DD,
 *  inclusive), soonest first. A deal date is date-only and leads its
 *  day; the timed appointments follow in clock order. */
export function buildCalendarTaskRows<
  A extends TaskAppointmentLike,
  D extends TaskDealDateLike,
>(
  appointments: readonly A[],
  dealDates: readonly D[],
  from: string,
  to: string
): CalendarTaskRow<A, D>[] {
  if (from > to) return [];
  const rows: CalendarTaskRow<A, D>[] = [];
  for (const dealDate of dealDates) {
    const day = dealDateLocalDay(dealDate.dueDate);
    const dayKey = localDateKey(day);
    if (dayKey < from || dayKey > to) continue;
    rows.push({ kind: 'deal', at: day.getTime(), dayKey, dealDate });
  }
  for (const appointment of appointments) {
    const at = new Date(appointment.start_time).getTime();
    if (!Number.isFinite(at)) continue;
    const dayKey = localDateKey(new Date(at));
    if (dayKey < from || dayKey > to) continue;
    rows.push({ kind: 'appointment', at, dayKey, appointment });
  }
  return rows.sort(
    (a, b) =>
      a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'deal' ? -1 : 1)
  );
}

export type TaskSortMode = 'upcoming' | 'earliest' | 'latest';

export const TASK_SORT_MODES: TaskSortMode[] = [
  'upcoming',
  'earliest',
  'latest',
];

export const TASK_SORT_LABELS: Record<TaskSortMode, string> = {
  upcoming: 'Upcoming first',
  earliest: 'Earliest first',
  latest: 'Latest first',
};

function localDayStamp(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function sortTasksByTime<T>(
  items: readonly T[],
  at: (item: T) => number,
  mode: TaskSortMode,
  now: Date,
  leads: (item: T) => boolean = () => false
): T[] {
  const today = localDayStamp(now.getTime());
  const rank = (t: number) => {
    const day = localDayStamp(t);
    return day === today ? 0 : day > today ? 1 : 2;
  };
  const inOrder = (a: T, b: T) =>
    at(a) - at(b) || (leads(a) === leads(b) ? 0 : leads(a) ? -1 : 1);
  return [...items].sort((a, b) => {
    if (mode === 'earliest') return inOrder(a, b);
    if (mode === 'latest') return inOrder(b, a);
    const ra = rank(at(a));
    const rb = rank(at(b));
    if (ra !== rb) return ra - rb;
    if (ra === 2) {
      const da = localDayStamp(at(a));
      const db = localDayStamp(at(b));
      if (da !== db) return db - da;
    }
    return inOrder(a, b);
  });
}

export function groupCalendarTaskRows<
  A extends TaskAppointmentLike,
  D extends TaskDealDateLike,
>(rows: readonly CalendarTaskRow<A, D>[]): CalendarTaskDay<A, D>[] {
  const days: CalendarTaskDay<A, D>[] = [];
  for (const row of rows) {
    const last = days[days.length - 1];
    if (last && last.dayKey === row.dayKey) last.rows.push(row);
    else days.push({ dayKey: row.dayKey, rows: [row] });
  }
  return days;
}
