/**
 * Appointment status changes — hand-ported mirror of the actions in
 * src/lib/calendar/tasks-view.ts (CAL-010). Guarded by
 * src/lib/mobile-parity.test.ts; edit both together.
 */

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

/** Mirrored from src/lib/calendar/tasks-view.ts (APPOINTMENT_STATUS_LABELS). */
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export interface AppointmentStatusAction {
  status: AppointmentStatus;
  label: string;
}

/** Mirrored from src/lib/calendar/tasks-view.ts (appointmentStatusActions). */
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
