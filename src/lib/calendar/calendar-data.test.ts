import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_COLUMNS,
  APPOINTMENT_SELECT,
  TODO_COLUMNS,
  TODO_SELECT,
  appointmentWindow,
  calendarWindowKey,
  inCalendarWindow,
  loadAllPages,
  mergeById,
  nextPageOffset,
  patchCachedRows,
  startOfLocalDay,
} from './calendar-data';

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const columns = (list: string) => list.split(',').map((c) => c.trim());

function monthGrid(year: number, month: number): { first: Date; last: Date } {
  const lead = new Date(year, month, 1).getDay();
  const first = new Date(year, month, 1 - lead);
  const last = new Date(year, month, 1 - lead + 41, 23, 59, 59, 999);
  return { first, last };
}

describe('[CAL-025] what the calendar reads', () => {
  it('covers the whole six-week month grid for every month', () => {
    for (let year = 2024; year <= 2029; year++) {
      for (let month = 0; month < 12; month++) {
        const window = appointmentWindow(new Date(year, month, 15));
        const { first, last } = monthGrid(year, month);
        expect(inCalendarWindow(first.toISOString(), window)).toBe(true);
        expect(inCalendarWindow(last.toISOString(), window)).toBe(true);
      }
    }
  });

  it('covers the week around any day, whichever weekday starts it', () => {
    for (let day = 0; day < 800; day++) {
      const anchor = new Date(2026, 0, 1 + day, 12);
      const window = appointmentWindow(anchor);
      for (const offset of [-6, 6]) {
        const edge = new Date(anchor);
        edge.setDate(anchor.getDate() + offset);
        expect(inCalendarWindow(edge.toISOString(), window)).toBe(true);
      }
    }
  });

  it('is three whole months, shared by every day of the month shown', () => {
    const window = appointmentWindow(new Date(2026, 10, 28, 17, 45));
    expect(window.from).toEqual(new Date(2026, 9, 1));
    expect(window.to).toEqual(new Date(2027, 0, 1));
    expect(calendarWindowKey(window)).toBe(
      calendarWindowKey(appointmentWindow(new Date(2026, 10, 1)))
    );
    expect(calendarWindowKey(window)).not.toBe(
      calendarWindowKey(appointmentWindow(new Date(2026, 11, 1)))
    );
    expect(inCalendarWindow(window.to.toISOString(), window)).toBe(false);
  });

  it('starts today at local midnight', () => {
    expect(startOfLocalDay(new Date(2026, 10, 28, 17, 45))).toEqual(
      new Date(2026, 10, 28)
    );
  });

  it('names the columns the calendar reads and none it does not', () => {
    const appointment = columns(APPOINTMENT_COLUMNS);
    for (const needed of [
      'id',
      'user_id',
      'assigned_to',
      'remind_creator',
      'title',
      'description',
      'agenda',
      'minutes',
      'outcome',
      'event_type',
      'source',
      'transcript',
      'start_time',
      'end_time',
      'location',
      'status',
      'contact_id',
      'contact_ids',
      'property_id',
      'liaison_id',
      'reschedule_requested_at',
      'client_confirmed_at',
      'archived_at',
      'deal_id',
    ]) {
      expect(appointment).toContain(needed);
    }
    for (const unused of [
      '*',
      'copilot_search_text',
      'reminder_morning_sent',
      'reminder_1h_sent',
      'agent_reminder_sent',
      'overdue_nudge_sent',
      'reminders_rearmed_at',
    ]) {
      expect(appointment).not.toContain(unused);
    }
    expect(APPOINTMENT_SELECT).toContain('deal:deals(id, title)');
    expect(columns(TODO_COLUMNS)).toEqual(
      expect.arrayContaining([
        'id',
        'title',
        'description',
        'due_date',
        'priority',
        'completed',
        'contact_id',
        'property_id',
        'deal_id',
      ])
    );
    expect(TODO_SELECT.startsWith('*')).toBe(false);
  });

  it('reads a list to its end past one page', async () => {
    const all = Array.from({ length: 1203 }, (_, i) => i);
    const calls: [number, number][] = [];
    const rows = await loadAllPages(async (from, to) => {
      calls.push([from, to]);
      return all.slice(from, to + 1);
    }, 500);
    expect(rows).toEqual(all);
    expect(calls).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
  });

  it('pages a newest-first list until a short page ends it', () => {
    expect(nextPageOffset([], 100)).toBeUndefined();
    expect(nextPageOffset([new Array(100)], 100)).toBe(100);
    expect(nextPageOffset([new Array(100), new Array(100)], 100)).toBe(200);
    expect(
      nextPageOffset([new Array(100), new Array(40)], 100)
    ).toBeUndefined();
    expect(nextPageOffset([[]], 100)).toBeUndefined();
  });

  it('merges reads without repeating a row', () => {
    expect(
      mergeById(
        [
          { id: 'a', v: 1 },
          { id: 'b', v: 1 },
        ],
        undefined,
        [
          { id: 'b', v: 2 },
          { id: 'c', v: 2 },
        ]
      )
    ).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 1 },
      { id: 'c', v: 2 },
    ]);
  });

  it('applies one edit to every cached shape and leaves others alone', () => {
    type Row = { id: string; status: string };
    const done = (row: Row) =>
      row.id === 'b' ? { ...row, status: 'completed' } : row;
    const list: Row[] = [
      { id: 'a', status: 'scheduled' },
      { id: 'b', status: 'scheduled' },
    ];
    expect(patchCachedRows(list, done)).toEqual([
      { id: 'a', status: 'scheduled' },
      { id: 'b', status: 'completed' },
    ]);
    expect(
      patchCachedRows({ pages: [list, []], pageParams: [0, 100] }, done)
    ).toEqual({
      pages: [
        [
          { id: 'a', status: 'scheduled' },
          { id: 'b', status: 'completed' },
        ],
        [],
      ],
      pageParams: [0, 100],
    });
    expect(patchCachedRows({ id: 'b', status: 'scheduled' }, done)).toEqual({
      id: 'b',
      status: 'completed',
    });
    expect(
      patchCachedRows(list, (row: Row) => (row.id === 'a' ? null : row))
    ).toEqual([{ id: 'b', status: 'scheduled' }]);
    expect(patchCachedRows(undefined, done)).toBeUndefined();
    expect(patchCachedRows(null, done)).toBeNull();
  });

  it('is the one read rule on web and mobile, never the whole table', () => {
    const web = read('src/app/(dashboard)/calendar/page.tsx');
    const fetchers = read('src/lib/calendar/calendar-fetch.ts');
    const mobile = read('mobile/app/(app)/(tabs)/calendar.tsx');
    const mobileTodos = read('mobile/lib/todos.ts');
    expect(web).not.toMatch(/from\('appointments'\)\s*\.select\(\s*'\*/);
    expect(web).not.toMatch(/from\('todos'\)\s*\.select\(\s*'\*/);
    expect(web).toContain('loadWindowAppointments');
    expect(web).toContain('useInfiniteQuery');
    expect(fetchers).toContain('APPOINTMENT_SELECT');
    expect(fetchers).toContain('TODO_SELECT');
    expect(fetchers).not.toContain("select('*");
    expect(mobile).toContain('.select(APPOINTMENT_SELECT)');
    expect(mobile).not.toMatch(/from\('appointments'\)\s*\.select\(\s*'\*/);
    expect(mobileTodos).toContain('.select(TODO_SELECT)');
  });
});
