import { describe, expect, it } from 'vitest';

import { buildUpcomingCalendarItems } from './calendar-upcoming';

const now = new Date(2026, 8, 14, 9, 0);

describe('buildUpcomingCalendarItems', () => {
  it('combines future appointments and dated tasks chronologically', () => {
    const items = buildUpcomingCalendarItems(
      [
        {
          id: 'appointment-2',
          start_time: new Date(2026, 8, 16, 10, 0).toISOString(),
          status: 'scheduled' as const,
        },
        {
          id: 'appointment-1',
          start_time: new Date(2026, 8, 15, 12, 0).toISOString(),
          status: 'scheduled' as const,
        },
      ],
      [
        {
          id: 'todo-1',
          due_date: new Date(2026, 8, 15, 9, 0).toISOString(),
          completed: false,
        },
      ],
      now,
      now
    );

    expect(
      items.map((item) =>
        item.kind === 'appointment' ? item.appointment.id : item.todo.id
      )
    ).toEqual(['todo-1', 'appointment-1', 'appointment-2']);
  });

  it('omits today, closed items, undated tasks, and the selected future day', () => {
    const selected = new Date(2026, 8, 15, 8, 0);
    const items = buildUpcomingCalendarItems(
      [
        {
          id: 'today',
          start_time: new Date(2026, 8, 14, 18, 0).toISOString(),
          status: 'scheduled' as const,
        },
        {
          id: 'selected-day',
          start_time: new Date(2026, 8, 15, 12, 0).toISOString(),
          status: 'scheduled' as const,
        },
        {
          id: 'cancelled',
          start_time: new Date(2026, 8, 16, 12, 0).toISOString(),
          status: 'cancelled' as const,
        },
        {
          id: 'later',
          start_time: new Date(2026, 8, 17, 12, 0).toISOString(),
          status: 'scheduled' as const,
        },
      ],
      [
        { id: 'undated', due_date: null, completed: false },
        {
          id: 'completed',
          due_date: new Date(2026, 8, 16, 9, 0).toISOString(),
          completed: true,
        },
        {
          id: 'selected-todo',
          due_date: new Date(2026, 8, 15, 9, 0).toISOString(),
          completed: false,
        },
      ],
      now,
      selected
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('appointment');
    expect(
      items[0]?.kind === 'appointment' ? items[0].appointment.id : null
    ).toBe('later');
  });
});
