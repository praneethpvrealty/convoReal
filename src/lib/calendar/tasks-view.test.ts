import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_STATUS_LABELS,
  appointmentStatusActions,
  buildCalendarTaskRows,
  groupCalendarTaskRows,
} from './tasks-view';

const appointment = (
  id: string,
  start: Date,
  status: 'scheduled' | 'completed' | 'cancelled' = 'scheduled'
) => ({
  id,
  start_time: start.toISOString(),
  status,
});

const dealDate = (
  dealId: string,
  dueDate: string,
  kind: 'milestone' | 'payment' | 'expected_close' = 'milestone'
) => ({
  dealId,
  milestoneId: kind === 'expected_close' ? null : `${dealId}-ms`,
  kind,
  dueDate,
});

describe('[CAL-010] the Tasks list under the calendar', () => {
  it('lists every pinned row in the visible range, deal dates leading their day', () => {
    const rows = buildCalendarTaskRows(
      [
        appointment('late', new Date(2026, 9, 10, 16, 0)),
        appointment('early', new Date(2026, 9, 10, 9, 30)),
        appointment('before', new Date(2026, 8, 30, 9, 30)),
        appointment('after', new Date(2026, 10, 1, 9, 30)),
        appointment('cancelled', new Date(2026, 9, 3, 11, 0), 'cancelled'),
      ],
      [
        dealDate('deal-1', '2026-10-10'),
        dealDate('deal-2', '2026-10-01', 'expected_close'),
        dealDate('deal-3', '2026-09-29'),
      ],
      '2026-10-01',
      '2026-10-31'
    );
    expect(
      rows.map((r) =>
        r.kind === 'deal'
          ? `${r.dayKey} deal ${r.dealDate.dealId}`
          : `${r.dayKey} appt ${r.appointment.id}`
      )
    ).toEqual([
      '2026-10-01 deal deal-2',
      '2026-10-03 appt cancelled',
      '2026-10-10 deal deal-1',
      '2026-10-10 appt early',
      '2026-10-10 appt late',
    ]);
    expect(buildCalendarTaskRows([], [], '2026-10-31', '2026-10-01')).toEqual(
      []
    );
  });

  it('groups rows by day in order', () => {
    const rows = buildCalendarTaskRows(
      [
        appointment('a', new Date(2026, 9, 2, 9, 0)),
        appointment('b', new Date(2026, 9, 2, 10, 0)),
      ],
      [dealDate('d', '2026-10-04')],
      '2026-10-01',
      '2026-10-31'
    );
    const days = groupCalendarTaskRows(rows);
    expect(days.map((d) => [d.dayKey, d.rows.length])).toEqual([
      ['2026-10-02', 2],
      ['2026-10-04', 1],
    ]);
  });

  it('offers done and cancel on a scheduled event and reopen afterwards; cancelling keeps the row', () => {
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
    const rows = buildCalendarTaskRows(
      [appointment('x', new Date(2026, 9, 2, 9, 0), 'cancelled')],
      [],
      '2026-10-01',
      '2026-10-31'
    );
    expect(rows).toHaveLength(1);
  });
});
