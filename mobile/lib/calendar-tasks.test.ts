import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_STATUS_LABELS,
  ARCHIVE_BATCH_LIMIT,
  ARCHIVED_VIEW_LABELS,
  ARCHIVED_VIEWS,
  archivedInLists,
  archivedOnCalendar,
  toArchivedView,
  appointmentStatusActions,
  archivableAppointmentIds,
  canArchiveAppointment,
  chunkIds,
  isArchivedAppointment,
  sortTasksByTime,
  TASK_SORT_LABELS,
  TASK_SORT_MODES,
  withoutArchivedAppointments,
  type TaskSortMode,
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

describe('[CAL-011] archiving done and cancelled events on mobile', () => {
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

  it('offers every unarchived finished event to Archive done, in bounded requests', () => {
    expect(archivableAppointmentIds(finished)).toEqual(['a', 'e']);
    const many = Array.from({ length: ARCHIVE_BATCH_LIMIT + 5 }, (_, i) => ({
      id: String(i),
      status: 'completed' as const,
    }));
    const ids = archivableAppointmentIds(many);
    expect(ids).toHaveLength(ARCHIVE_BATCH_LIMIT + 5);
    expect(chunkIds(ids).map((chunk) => chunk.length)).toEqual([
      ARCHIVE_BATCH_LIMIT,
      5,
    ]);
    expect(chunkIds(ids).flat()).toEqual(ids);
    expect(chunkIds([])).toEqual([]);
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

describe('[CAL-012] tasks sorted by date and time on mobile', () => {
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

describe('[CAL-011] archived events on the calendar and in the lists on mobile', () => {
  it('greys archived events out on the calendar by default, hides them on request, and lists them only when asked', () => {
    expect(ARCHIVED_VIEWS[0]).toBe('greyed');
    expect(
      ARCHIVED_VIEWS.map((view) => [
        archivedOnCalendar(view),
        archivedInLists(view),
      ])
    ).toEqual([
      [true, false],
      [false, false],
      [true, true],
    ]);
    expect(ARCHIVED_VIEW_LABELS).toEqual({
      greyed: 'Grey out archived',
      hidden: 'Hide archived',
      listed: 'List archived',
    });
  });

  it('reads a stored setting and falls back to Grey out for anything unknown', () => {
    expect(toArchivedView('hidden')).toBe('hidden');
    expect(toArchivedView('listed')).toBe('listed');
    expect(toArchivedView('greyed')).toBe('greyed');
    for (const value of [null, undefined, '', 'HIDDEN', 'shown', 3]) {
      expect(toArchivedView(value)).toBe('greyed');
    }
  });
});
