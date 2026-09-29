import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_STATUS_LABELS,
  ARCHIVE_BATCH_LIMIT,
  appointmentStatusActions,
  archivableAppointmentIds,
  buildCalendarTaskRows,
  canArchiveAppointment,
  groupCalendarTaskRows,
  isArchivedAppointment,
  sortTasksByTime,
  TASK_SORT_LABELS,
  TASK_SORT_MODES,
  withoutArchivedAppointments,
  type TaskSortMode,
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

describe('[CAL-011] archiving done and cancelled events', () => {
  const finished = [
    { id: 'a', status: 'completed' as const, archived_at: null },
    {
      id: 'b',
      status: 'cancelled' as const,
      archived_at: '2026-09-29T10:00:00.000Z',
    },
    { id: 'c', status: 'scheduled' as const, archived_at: null },
    {
      id: 'd',
      status: 'scheduled' as const,
      archived_at: '2026-09-29T10:00:00.000Z',
    },
    { id: 'e', status: 'cancelled' as const },
  ];

  it('archives only a done or cancelled event and never hides a scheduled one', () => {
    expect(canArchiveAppointment('completed')).toBe(true);
    expect(canArchiveAppointment('cancelled')).toBe(true);
    expect(canArchiveAppointment('scheduled')).toBe(false);
    expect(finished.map((a) => isArchivedAppointment(a))).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it('offers every unarchived finished event to Archive done', () => {
    expect(archivableAppointmentIds(finished)).toEqual(['a', 'e']);
    const many = Array.from({ length: ARCHIVE_BATCH_LIMIT + 5 }, (_, i) => ({
      id: String(i),
      status: 'completed' as const,
    }));
    expect(archivableAppointmentIds(many)).toHaveLength(ARCHIVE_BATCH_LIMIT);
  });

  it('hides archived events from the list until they are shown', () => {
    expect(withoutArchivedAppointments(finished, false)).toEqual({
      visible: finished.filter((a) => a.id !== 'b'),
      archivedCount: 1,
    });
    expect(withoutArchivedAppointments(finished, true)).toEqual({
      visible: finished,
      archivedCount: 1,
    });
  });
});

describe('[CAL-012] tasks sorted by date and time', () => {
  const now = new Date(2026, 8, 29, 12, 0);
  const at = (day: number, hour: number) =>
    new Date(2026, 8, day, hour, 0).getTime();
  const items = [
    { id: 'three-days-ago', at: at(26, 9) },
    { id: 'yesterday', at: at(28, 10) },
    { id: 'today-late', at: at(29, 15) },
    { id: 'today-deal', at: at(29, 0), deal: true },
    { id: 'today-early', at: at(29, 9) },
    { id: 'next-week', at: at(36, 11) },
    { id: 'yesterday-early', at: at(28, 8) },
    { id: 'tomorrow', at: at(30, 8) },
  ];
  const order = (mode: TaskSortMode) =>
    sortTasksByTime(
      items,
      (i) => i.at,
      mode,
      now,
      (i) => !!i.deal
    ).map((i) => i.id);

  it('puts today first, then the days ahead, then the most recent past days', () => {
    expect(order('upcoming')).toEqual([
      'today-deal',
      'today-early',
      'today-late',
      'tomorrow',
      'next-week',
      'yesterday-early',
      'yesterday',
      'three-days-ago',
    ]);
  });

  it('orders strictly by date and time for Earliest and Latest first', () => {
    const earliest = [
      'three-days-ago',
      'yesterday-early',
      'yesterday',
      'today-deal',
      'today-early',
      'today-late',
      'tomorrow',
      'next-week',
    ];
    expect(order('earliest')).toEqual(earliest);
    expect(order('latest')).toEqual([...earliest].reverse());
  });

  it('labels every mode and defaults the list to Upcoming first', () => {
    expect(TASK_SORT_MODES[0]).toBe('upcoming');
    expect(TASK_SORT_LABELS).toEqual({
      upcoming: 'Upcoming first',
      earliest: 'Earliest first',
      latest: 'Latest first',
    });
  });
});
