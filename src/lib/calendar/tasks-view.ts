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
