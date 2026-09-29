import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_STATUS_LABELS,
  appointmentStatusActions,
} from './calendar-tasks';

describe('[CAL-010] appointment status changes on mobile', () => {
  it('offers done and cancel on a scheduled event and reopen afterwards', () => {
    expect(appointmentStatusActions('scheduled')).toEqual([
      { status: 'completed', label: 'Done' },
      { status: 'cancelled', label: 'Cancel' },
    ]);
    expect(appointmentStatusActions('completed')).toEqual([
      { status: 'scheduled', label: 'Reopen' },
    ]);
    expect(appointmentStatusActions('cancelled')).toEqual([
      { status: 'scheduled', label: 'Reopen' },
    ]);
    expect(APPOINTMENT_STATUS_LABELS).toEqual({
      scheduled: 'Scheduled',
      completed: 'Completed',
      cancelled: 'Cancelled',
    });
  });
});
