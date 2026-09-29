import { describe, expect, it } from 'vitest';

import {
  DEAL_DEADLINE_HORIZON_DAYS,
  DEAL_DEADLINE_PAGE_ORDER,
  DEAL_DEADLINE_PAGE_SIZE,
  DEAL_DEADLINE_REMINDER_DAYS,
  daysBetween,
  deadlineLabel,
  deadlineUrgency,
  deadlinesForAgent,
  loadDealDeadlineRowsForAccount,
  loadDealDeadlines,
  sortDeadlines,
  summarizeDeadlines,
  toDealDeadline,
  todayDateKey,
  type DealDeadlineRow,
} from './deadlines';

function row(over: Partial<DealDeadlineRow> = {}): DealDeadlineRow {
  return {
    deal_id: 'deal-1',
    deal_title: 'JP Nagar #19',
    contact_name: 'Sidharth',
    property_title: 'JP Nagar site',
    property_unit_no: '19',
    kind: 'milestone',
    milestone_id: 'm-1',
    title: 'Registration scheduled',
    due_date: '2026-10-10',
    assigned_to: null,
    owner_user_id: 'user-1',
    ...over,
  };
}

describe('[TXW-020] deal deadlines', () => {
  it('counts whole days between date-only strings, ignoring clocks', () => {
    expect(daysBetween('2026-09-24', '2026-10-10')).toBe(16);
    expect(daysBetween('2026-10-10', '2026-09-24')).toBe(-16);
    expect(daysBetween('2026-09-24', '2026-09-24')).toBe(0);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('not a date', '2026-09-24')).toBe(0);
  });

  it('names the day in the requested calendar', () => {
    const late = new Date('2026-09-24T20:30:00.000Z');
    expect(todayDateKey(late, 'UTC')).toBe('2026-09-24');
    expect(todayDateKey(late, 'Asia/Kolkata')).toBe('2026-09-25');
  });

  it('classifies overdue, today and soon from the day count', () => {
    expect(deadlineUrgency(-1)).toBe('overdue');
    expect(deadlineUrgency(0)).toBe('today');
    expect(deadlineUrgency(1)).toBe('soon');
    expect(deadlineUrgency(14)).toBe('soon');
  });

  it('labels the distance in the agent’s words', () => {
    expect(deadlineLabel(-3)).toBe('Overdue by 3 days');
    expect(deadlineLabel(-1)).toBe('Overdue by 1 day');
    expect(deadlineLabel(0)).toBe('Due today');
    expect(deadlineLabel(1)).toBe('Due tomorrow');
    expect(deadlineLabel(5)).toBe('Due in 5 days');
  });

  it('heads a deadline with the buyer and property, as the Records index does', () => {
    const d = toDealDeadline(row(), '2026-10-07');
    expect(d.subject).toBe('Sidharth — Property No. 19');
    expect(d.title).toBe('Registration scheduled');
    expect(d.daysLeft).toBe(3);
    expect(d.urgency).toBe('soon');
    expect(d.milestoneId).toBe('m-1');
  });

  it('falls back to the deal title when the record names nobody', () => {
    const d = toDealDeadline(
      row({
        contact_name: null,
        property_title: null,
        property_unit_no: null,
        kind: 'expected_close',
        milestone_id: null,
        title: 'Expected close',
      }),
      '2026-10-12'
    );
    expect(d.subject).toBe('JP Nagar #19');
    expect(d.urgency).toBe('overdue');
    expect(d.daysLeft).toBe(-2);
  });

  it('orders soonest first and, on one day, milestone before payment before expected close', () => {
    const today = '2026-10-01';
    const sorted = sortDeadlines([
      toDealDeadline(
        row({
          kind: 'payment',
          milestone_id: 't-1',
          title: 'Payment: On registration',
        }),
        today
      ),
      toDealDeadline(
        row({
          kind: 'expected_close',
          milestone_id: null,
          title: 'Expected close',
        }),
        today
      ),
      toDealDeadline(
        row({ due_date: '2026-10-12', title: 'Possession' }),
        today
      ),
      toDealDeadline(row({ title: 'Registration scheduled' }), today),
      toDealDeadline(row({ due_date: '2026-09-30', title: 'TDS' }), today),
    ]);
    expect(sorted.map((d) => `${d.dueDate} ${d.title}`)).toEqual([
      '2026-09-30 TDS',
      '2026-10-10 Registration scheduled',
      '2026-10-10 Payment: On registration',
      '2026-10-10 Expected close',
      '2026-10-12 Possession',
    ]);
  });

  it('summarises by urgency', () => {
    const today = '2026-10-10';
    const items = [
      toDealDeadline(row({ due_date: '2026-10-08' }), today),
      toDealDeadline(row({ due_date: '2026-10-10' }), today),
      toDealDeadline(row({ due_date: '2026-10-11' }), today),
      toDealDeadline(row({ due_date: '2026-10-20' }), today),
    ];
    expect(summarizeDeadlines(items)).toEqual({
      total: 4,
      overdue: 1,
      dueToday: 1,
      soon: 2,
    });
  });

  it('reminds an agent about their assigned deals and the unassigned ones they opened', () => {
    const rows = [
      row({ deal_id: 'mine', assigned_to: 'profile-a' }),
      row({ deal_id: 'theirs', assigned_to: 'profile-b' }),
      row({ deal_id: 'opened', assigned_to: null, owner_user_id: 'user-a' }),
      row({ deal_id: 'other', assigned_to: null, owner_user_id: 'user-b' }),
    ];
    expect(
      deadlinesForAgent(rows, { profileId: 'profile-a', userId: 'user-a' }).map(
        (r) => r.deal_id
      )
    ).toEqual(['mine', 'opened']);
  });

  it('reminds over a shorter window than the screens look ahead', () => {
    expect(DEAL_DEADLINE_REMINDER_DAYS).toBeLessThan(
      DEAL_DEADLINE_HORIZON_DAYS
    );
  });
});

describe('[CAL-008] deadline reads page past the PostgREST row cap', () => {
  function fakeDb(pages: DealDeadlineRow[][]) {
    const calls: { from: number; to: number; order: string[] }[] = [];
    let call = 0;
    const db = {
      rpc: () => {
        const current = { from: 0, to: 0, order: [] as string[] };
        const query = {
          order(column: string) {
            current.order.push(column);
            return query;
          },
          range(from: number, to: number) {
            current.from = from;
            current.to = to;
            calls.push(current);
            return query;
          },
          then(resolve: (value: { data: unknown; error: null }) => void) {
            const data = pages[call] ?? [];
            call += 1;
            resolve({ data, error: null });
          },
        };
        return query;
      },
    };
    return { db, calls };
  }

  it('keeps asking for the next page until a short one comes back, in a pinned order', async () => {
    const full = Array.from({ length: DEAL_DEADLINE_PAGE_SIZE }, (_, i) =>
      row({ milestone_id: `m-${i}`, due_date: '2026-10-10' })
    );
    const tail = [row({ milestone_id: 'm-last', due_date: '2027-01-05' })];
    const { db, calls } = fakeDb([full, tail]);

    const items = await loadDealDeadlines(
      db as unknown as Parameters<typeof loadDealDeadlines>[0],
      'acc',
      '2026-09-29',
      365
    );

    expect(items).toHaveLength(DEAL_DEADLINE_PAGE_SIZE + 1);
    expect(items[items.length - 1]?.milestoneId).toBe('m-last');
    expect(calls.map((c) => [c.from, c.to])).toEqual([
      [0, DEAL_DEADLINE_PAGE_SIZE - 1],
      [DEAL_DEADLINE_PAGE_SIZE, DEAL_DEADLINE_PAGE_SIZE * 2 - 1],
    ]);
    for (const c of calls) {
      expect(c.order).toEqual([...DEAL_DEADLINE_PAGE_ORDER]);
    }
  });

  it('stops after one short page and returns raw rows for the digest', async () => {
    const { db, calls } = fakeDb([[row({})]]);
    const rows = await loadDealDeadlineRowsForAccount(
      db as unknown as Parameters<typeof loadDealDeadlineRowsForAccount>[0],
      'acc',
      '2026-09-29',
      3
    );
    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});
