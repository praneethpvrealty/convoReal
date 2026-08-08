import { describe, it, expect, vi } from 'vitest';
import {
  openOverdueEvents,
  subjectOf,
  openEventLabel,
  type OpenEvent,
} from './open-event-subject';

/**
 * The card-independent path. Both earlier lookups needed a bot message
 * the Engine had registered, so a nudge sent before that plumbing
 * existed could never be answered — the bot asked "how did it go?" and
 * then could not read the reply to its own question.
 */

interface Row {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  assigned_to: string | null;
  user_id: string | null;
}

function db(rows: Row[], capture?: Record<string, unknown>) {
  const filters: Record<string, unknown> = capture ?? {};
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: (c: string, v: unknown) => {
      filters[c] = v;
      return builder;
    },
    lt: (c: string, v: unknown) => {
      filters[`lt_${c}`] = v;
      return builder;
    },
    gte: (c: string, v: unknown) => {
      filters[`gte_${c}`] = v;
      return builder;
    },
    order: () => builder,
    limit: (n: number) => {
      filters.limit = n;
      return builder;
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  });
  return { from: () => builder } as never;
}

const NOW = new Date('2026-08-08T08:16:00Z');

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'appt-1',
    title: 'Site visit',
    start_time: '2026-08-08T04:30:00Z',
    end_time: '2026-08-08T05:30:00Z',
    assigned_to: 'agent-1',
    user_id: 'agent-1',
    ...over,
  };
}

describe('openOverdueEvents', () => {
  it('finds the visit the agent is reporting on', async () => {
    const events = await openOverdueEvents({
      db: db([row()]),
      accountId: 'acc',
      userId: 'agent-1',
      now: NOW,
    });
    expect(events).toEqual([
      { id: 'appt-1', title: 'Site visit', start_time: '2026-08-08T04:30:00Z' },
    ]);
  });

  it('asks only for events that are open and already past', async () => {
    const filters: Record<string, unknown> = {};
    await openOverdueEvents({
      db: db([], filters),
      accountId: 'acc',
      userId: 'agent-1',
      now: NOW,
    });
    expect(filters).toMatchObject({ account_id: 'acc', status: 'scheduled' });
    expect(filters.lt_end_time).toBe(NOW.toISOString());
  });

  it('bounds the window so an ancient event cannot be closed by a stray reply', async () => {
    const filters: Record<string, unknown> = {};
    await openOverdueEvents({
      db: db([], filters),
      accountId: 'acc',
      userId: 'agent-1',
      now: NOW,
      withinHours: 48,
    });
    const since = new Date(filters.gte_end_time as string).getTime();
    expect(NOW.getTime() - since).toBe(48 * 3600_000);
  });

  it('is the assignee\'s event, not the booker\'s', async () => {
    // A manager books, an agent runs it — the nudge went to the
    // assignee, so the answer is the assignee's to give.
    const rows = [row({ id: 'mine', assigned_to: 'agent-1', user_id: 'manager' })];
    expect(
      (await openOverdueEvents({ db: db(rows), accountId: 'acc', userId: 'agent-1', now: NOW })).map(
        (e) => e.id,
      ),
    ).toEqual(['mine']);
  });

  it('leaves a teammate\'s event alone', async () => {
    const rows = [row({ id: 'theirs', assigned_to: 'agent-2', user_id: 'agent-2' })];
    expect(
      await openOverdueEvents({ db: db(rows), accountId: 'acc', userId: 'agent-1', now: NOW }),
    ).toEqual([]);
  });

  it('returns nothing rather than throwing when the query fails', async () => {
    const failing = {
      from: () => {
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          eq: () => b,
          lt: () => b,
          gte: () => b,
          order: () => b,
          limit: () => b,
          then: (r: (v: { data: null; error: { message: string } }) => unknown) =>
            r({ data: null, error: { message: 'boom' } }),
        });
        return b;
      },
    } as never;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await openOverdueEvents({ db: failing, accountId: 'acc', userId: 'agent-1', now: NOW }),
    ).toEqual([]);
  });
});

describe('subjectOf', () => {
  const e = (id: string): OpenEvent => ({
    id,
    title: `Visit ${id}`,
    start_time: '2026-08-08T04:30:00Z',
  });

  it('takes the single open event as the subject', () => {
    expect(subjectOf([e('a')])).toEqual({ kind: 'one', event: e('a') });
  });

  it('refuses to guess between two', () => {
    // Closing the wrong meeting is worse than asking which one.
    expect(subjectOf([e('a'), e('b')]).kind).toBe('many');
  });

  it('has no subject when nothing is open', () => {
    expect(subjectOf([])).toEqual({ kind: 'none' });
  });
});

describe('openEventLabel', () => {
  it('names the event and when it was, in IST', () => {
    expect(
      openEventLabel({ id: 'a', title: 'Site visit', start_time: '2026-08-08T04:30:00Z' }),
    ).toBe('Site visit — Sat, 10:00 am');
  });
});
