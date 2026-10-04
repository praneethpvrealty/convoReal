import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ParsedContactDraftsContainer,
  ParsedPropertyDraft,
} from './gemini';
import {
  DRAFT_MUTATION_MAX_ATTEMPTS,
  DRAFT_SESSION_TIMEOUT_MS,
  deleteContactDraftSession,
  deletePropertyDraftSession,
  findContactDraftSession,
  findPropertyDraftSession,
  findPropertyDraftSessionById,
  insertContactDraftSession,
  insertPropertyDraftSession,
  isDraftSessionExpired,
  mutateContactDraft,
  mutatePropertyDraft,
  overwriteContactDraftSession,
  touchPropertyDraftSession,
  type PropertyDraftSessionRow,
} from './draft-sessions';

type Op = 'select' | 'update' | 'delete' | 'insert';
type Result = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

interface Call {
  table: string;
  op: Op;
  columns?: string;
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
  returning: boolean;
  terminal: 'single' | 'maybeSingle' | 'list';
}

function stubClient(respond: (call: Call) => Result) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = {
        table,
        op: 'select',
        filters: [],
        returning: false,
        terminal: 'list',
      };
      let opSet = false;
      calls.push(call);
      const finish = (terminal: Call['terminal']) => {
        call.terminal = terminal;
        return Promise.resolve(respond(call));
      };
      const chain = {
        select: (columns?: string) => {
          if (opSet) {
            call.returning = true;
          } else {
            opSet = true;
            call.columns = columns;
          }
          return chain;
        },
        update: (payload: Record<string, unknown>) => {
          opSet = true;
          call.op = 'update';
          call.payload = payload;
          return chain;
        },
        insert: (payload: Record<string, unknown>) => {
          opSet = true;
          call.op = 'insert';
          call.payload = payload;
          return chain;
        },
        delete: () => {
          opSet = true;
          call.op = 'delete';
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        single: () => finish('single'),
        maybeSingle: () => finish('maybeSingle'),
        then: (
          onFulfilled: (value: Result) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => finish('list').then(onFulfilled, onRejected),
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ok = (data: unknown): Result => ({ data, error: null });

const DRAFT = {
  title: 'Lake View',
  images: [],
} as unknown as ParsedPropertyDraft;
const NEXT_DRAFT = {
  title: 'Lake View',
  images: ['a.jpg'],
} as unknown as ParsedPropertyDraft;
const CONTAINER = { contacts: [] } as ParsedContactDraftsContainer;

function sessionRow(
  overrides: Partial<PropertyDraftSessionRow> = {}
): PropertyDraftSessionRow {
  return {
    id: 's1',
    account_id: 'a1',
    contact_id: 'c1',
    draft_data: DRAFT,
    status: 'collecting',
    session_mode: 'owner',
    requirement_link_id: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('draft session finders', () => {
  it('reads the property session by contact without a mode filter when no mode is given', async () => {
    const row = sessionRow();
    const { client, calls } = stubClient(() => ok(row));

    const result = await findPropertyDraftSession(client, 'c1');

    expect(result).toEqual({ data: row, error: null });
    expect(calls).toEqual([
      {
        table: 'property_draft_sessions',
        op: 'select',
        columns: '*',
        filters: [['contact_id', 'c1']],
        returning: false,
        terminal: 'maybeSingle',
      },
    ]);
  });

  it('adds the session_mode filter when a mode is given', async () => {
    const { client, calls } = stubClient(() => ok(null));

    const result = await findPropertyDraftSession(client, 'c1', 'external');

    expect(result).toEqual({ data: null, error: null });
    expect(calls[0].filters).toEqual([
      ['contact_id', 'c1'],
      ['session_mode', 'external'],
    ]);
    expect(calls[0].terminal).toBe('maybeSingle');
  });

  it('passes a read error through', async () => {
    const error = { code: '42P01', message: 'boom' };
    const { client } = stubClient(() => ({ data: null, error }));

    const result = await findPropertyDraftSession(client, 'c1');

    expect(result).toEqual({ data: null, error });
  });

  it('reads the property session by id', async () => {
    const { client, calls } = stubClient(() => ok(sessionRow()));

    await findPropertyDraftSessionById(client, 's1');

    expect(calls[0]).toMatchObject({
      table: 'property_draft_sessions',
      op: 'select',
      columns: '*',
      filters: [['id', 's1']],
      terminal: 'maybeSingle',
    });
  });

  it('reads the contact session by contact', async () => {
    const { client, calls } = stubClient(() => ok(null));

    await findContactDraftSession(client, 'c1');

    expect(calls[0]).toMatchObject({
      table: 'contact_draft_sessions',
      op: 'select',
      columns: '*',
      filters: [['contact_id', 'c1']],
      terminal: 'maybeSingle',
    });
  });
});

describe('draft session writes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes a property session by id', async () => {
    const { client, calls } = stubClient(() => ok(null));

    await deletePropertyDraftSession(client, 's1');

    expect(calls).toEqual([
      {
        table: 'property_draft_sessions',
        op: 'delete',
        filters: [['id', 's1']],
        returning: false,
        terminal: 'list',
      },
    ]);
  });

  it('deletes a contact session by id', async () => {
    const { client, calls } = stubClient(() => ok(null));

    await deleteContactDraftSession(client, 'k1');

    expect(calls[0]).toMatchObject({
      table: 'contact_draft_sessions',
      op: 'delete',
      filters: [['id', 'k1']],
    });
  });

  it('touches only updated_at on the property session', async () => {
    const { client, calls } = stubClient(() => ok(null));

    await touchPropertyDraftSession(client, 's1');

    expect(calls[0]).toMatchObject({
      table: 'property_draft_sessions',
      op: 'update',
      payload: { updated_at: '2026-10-04T10:00:00.000Z' },
      filters: [['id', 's1']],
      returning: false,
    });
  });

  it('overwrites a contact session without a precondition', async () => {
    const { client, calls } = stubClient(() => ok(null));

    await overwriteContactDraftSession(
      client,
      'k1',
      CONTAINER,
      'awaiting_confirmation'
    );

    expect(calls[0]).toMatchObject({
      table: 'contact_draft_sessions',
      op: 'update',
      payload: {
        draft_data: CONTAINER,
        status: 'awaiting_confirmation',
        updated_at: '2026-10-04T10:00:00.000Z',
      },
      filters: [['id', 'k1']],
      returning: false,
    });
  });

  it('inserts a property session and returns the inserted rows', async () => {
    const row = sessionRow();
    const { client, calls } = stubClient(() => ok([row]));
    const insert = {
      account_id: 'a1',
      contact_id: 'c1',
      draft_data: DRAFT,
      status: 'collecting' as const,
    };

    const result = await insertPropertyDraftSession(client, insert);

    expect(result).toEqual({ data: [row], error: null });
    expect(calls[0]).toMatchObject({
      table: 'property_draft_sessions',
      op: 'insert',
      payload: insert,
      returning: true,
    });
  });

  it('surfaces a unique violation from the property insert', async () => {
    const error = { code: '23505', message: 'duplicate' };
    const { client } = stubClient(() => ({ data: null, error }));

    const result = await insertPropertyDraftSession(client, {
      account_id: 'a1',
      contact_id: 'c1',
      draft_data: DRAFT,
      status: 'collecting',
    });

    expect(result).toEqual({ data: null, error });
  });

  it('inserts a contact session without asking for the row back', async () => {
    const error = { code: '23505', message: 'duplicate' };
    const { client, calls } = stubClient(() => ({ data: null, error }));
    const insert = {
      account_id: 'a1',
      contact_id: 'c1',
      draft_data: CONTAINER,
      status: 'collecting' as const,
    };

    const result = await insertContactDraftSession(client, insert);

    expect(result).toEqual({ error });
    expect(calls[0]).toMatchObject({
      table: 'contact_draft_sessions',
      op: 'insert',
      payload: insert,
      returning: false,
    });
  });
});

describe('mutatePropertyDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const next = () => ({
    draft_data: NEXT_DRAFT,
    status: 'awaiting_confirmation' as const,
  });

  it('writes with the updated_at precondition and returns the written row', async () => {
    const written = sessionRow({ updated_at: '2026-10-04T10:00:00.000Z' });
    const { client, calls } = stubClient((call) =>
      call.op === 'select' ? ok(sessionRow()) : ok([written])
    );
    const callback = vi.fn(next);

    const result = await mutatePropertyDraft(client, 's1', callback);

    expect(result).toEqual({ status: 'ok', row: written, next: next() });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(sessionRow());
    expect(calls).toEqual([
      {
        table: 'property_draft_sessions',
        op: 'select',
        columns: '*',
        filters: [['id', 's1']],
        returning: false,
        terminal: 'single',
      },
      {
        table: 'property_draft_sessions',
        op: 'update',
        payload: {
          draft_data: NEXT_DRAFT,
          status: 'awaiting_confirmation',
          updated_at: '2026-10-04T10:00:00.000Z',
        },
        filters: [
          ['id', 's1'],
          ['updated_at', '2026-10-01T00:00:00.000Z'],
        ],
        returning: true,
        terminal: 'list',
      },
    ]);
  });

  it('re-reads and retries after an empty update result, running the callback per attempt', async () => {
    const reads = [
      sessionRow({ updated_at: 'v1' }),
      sessionRow({ updated_at: 'v2' }),
    ];
    const updates: Result[] = [ok([]), ok([sessionRow({ updated_at: 'v3' })])];
    const { client, calls } = stubClient((call) =>
      call.op === 'select' ? ok(reads.shift()) : updates.shift()!
    );
    const callback = vi.fn(next);

    const pending = mutatePropertyDraft(client, 's1', callback);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.status).toBe('ok');
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(
      2,
      sessionRow({ updated_at: 'v2' })
    );
    const preconditions = calls
      .filter((call) => call.op === 'update')
      .map((call) => call.filters[1]);
    expect(preconditions).toEqual([
      ['updated_at', 'v1'],
      ['updated_at', 'v2'],
    ]);
  });

  it('retries after an update error', async () => {
    const updates: Result[] = [
      { data: null, error: { message: 'timeout' } },
      ok([sessionRow()]),
    ];
    const { client } = stubClient((call) =>
      call.op === 'select' ? ok(sessionRow()) : updates.shift()!
    );

    const pending = mutatePropertyDraft(client, 's1', next);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ status: 'ok' });
  });

  it('sleeps between 50 and 250 ms after a failed write', async () => {
    const updates: Result[] = [ok([]), ok([sessionRow()])];
    const { client, calls } = stubClient((call) =>
      call.op === 'select' ? ok(sessionRow()) : updates.shift()!
    );
    vi.spyOn(Math, 'random').mockReturnValue(1);

    const pending = mutatePropertyDraft(client, 's1', next);
    await vi.advanceTimersByTimeAsync(249);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(calls).toHaveLength(4);
  });

  it('waits at least 50 ms before retrying', async () => {
    const updates: Result[] = [ok([]), ok([sessionRow()])];
    const { client, calls } = stubClient((call) =>
      call.op === 'select' ? ok(sessionRow()) : updates.shift()!
    );
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const pending = mutatePropertyDraft(client, 's1', next);
    await vi.advanceTimersByTimeAsync(49);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(calls).toHaveLength(4);
  });

  it('returns gone when the session was deleted (PGRST116)', async () => {
    const { client, calls } = stubClient(() => ({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    }));
    const callback = vi.fn(next);

    const result = await mutatePropertyDraft(client, 's1', callback);

    expect(result).toEqual({ status: 'gone' });
    expect(callback).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('returns the read error for any other failed read', async () => {
    const error = { code: '08006', message: 'connection lost' };
    const { client } = stubClient(() => ({ data: null, error }));

    const result = await mutatePropertyDraft(client, 's1', next);

    expect(result).toEqual({ status: 'error', error });
  });

  it('returns an error with no cause when the read yields no row and no error', async () => {
    const { client } = stubClient(() => ok(null));

    const result = await mutatePropertyDraft(client, 's1', next);

    expect(result).toEqual({ status: 'error', error: null });
  });

  it('returns conflict once the retry budget is spent', async () => {
    const { client, calls } = stubClient((call) =>
      call.op === 'select' ? ok(sessionRow()) : ok([])
    );
    const callback = vi.fn(next);

    const pending = mutatePropertyDraft(client, 's1', callback);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toEqual({ status: 'conflict' });
    expect(DRAFT_MUTATION_MAX_ATTEMPTS).toBe(5);
    expect(callback).toHaveBeenCalledTimes(5);
    expect(calls.filter((call) => call.op === 'update')).toHaveLength(5);
  });

  it('returns skipped without writing when the callback returns null', async () => {
    const { client, calls } = stubClient(() => ok(sessionRow()));

    const result = await mutatePropertyDraft(client, 's1', async () => null);

    expect(result).toEqual({ status: 'skipped' });
    expect(calls.map((call) => call.op)).toEqual(['select']);
  });

  it('propagates a callback failure', async () => {
    const { client } = stubClient(() => ok(sessionRow()));

    await expect(
      mutatePropertyDraft(client, 's1', async () => {
        throw new Error('model down');
      })
    ).rejects.toThrow('model down');
  });

  describe('with onMissingRow: retry', () => {
    it('counts a missing row as an attempt without sleeping or calling back', async () => {
      const reads: Result[] = [
        { data: null, error: { code: 'PGRST116', message: 'no rows' } },
        ok(sessionRow()),
      ];
      const { client, calls } = stubClient((call) =>
        call.op === 'select' ? reads.shift()! : ok([sessionRow()])
      );
      const callback = vi.fn(next);

      const result = await mutatePropertyDraft(client, 's1', callback, {
        onMissingRow: 'retry',
      });

      expect(result.status).toBe('ok');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(calls.map((call) => call.op)).toEqual([
        'select',
        'select',
        'update',
      ]);
    });

    it('returns conflict after five missing reads', async () => {
      const { client, calls } = stubClient(() => ({
        data: null,
        error: { code: 'PGRST116', message: 'no rows' },
      }));
      const callback = vi.fn(next);

      const result = await mutatePropertyDraft(client, 's1', callback, {
        onMissingRow: 'retry',
      });

      expect(result).toEqual({ status: 'conflict' });
      expect(callback).not.toHaveBeenCalled();
      expect(calls).toHaveLength(5);
    });

    it('shares the attempt budget between missing reads and failed writes', async () => {
      const reads: Result[] = [
        ok(null),
        ok(sessionRow()),
        ok(null),
        ok(sessionRow()),
        ok(null),
      ];
      const { client, calls } = stubClient((call) =>
        call.op === 'select' ? reads.shift()! : ok([])
      );

      const pending = mutatePropertyDraft(client, 's1', next, {
        onMissingRow: 'retry',
      });
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toEqual({ status: 'conflict' });
      expect(calls.map((call) => call.op)).toEqual([
        'select',
        'select',
        'update',
        'select',
        'select',
        'update',
        'select',
      ]);
    });
  });
});

describe('mutateContactDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const nextContact = () => ({
    draft_data: CONTAINER,
    status: 'collecting' as const,
  });

  it('writes the contact session with the updated_at precondition', async () => {
    const written = sessionRow({ updated_at: '2026-10-04T10:00:00.000Z' });
    const { client, calls } = stubClient((call) =>
      call.op === 'select' ? ok(sessionRow()) : ok([written])
    );

    const result = await mutateContactDraft(client, 'c1', nextContact);

    expect(result).toEqual({ status: 'ok', row: written, next: nextContact() });
    expect(calls.map((c) => [c.table, c.op, c.filters])).toEqual([
      ['contact_draft_sessions', 'select', [['id', 'c1']]],
      [
        'contact_draft_sessions',
        'update',
        [
          ['id', 'c1'],
          ['updated_at', '2026-10-01T00:00:00.000Z'],
        ],
      ],
    ]);
  });

  it('retries a lost race against the newer row instead of overwriting it', async () => {
    const reads = [
      sessionRow({ updated_at: 'v1' }),
      sessionRow({ updated_at: 'v2' }),
    ];
    const updates: Result[] = [ok([]), ok([sessionRow({ updated_at: 'v3' })])];
    const { client } = stubClient((call) =>
      call.op === 'select' ? ok(reads.shift()) : updates.shift()!
    );
    const callback = vi.fn(nextContact);

    const pending = mutateContactDraft(client, 'c1', callback);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.status).toBe('ok');
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(sessionRow({ updated_at: 'v2' }));
  });

  it('reports a deleted contact session as gone', async () => {
    const { client } = stubClient(() => ({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    }));

    expect(await mutateContactDraft(client, 'c1', nextContact)).toEqual({
      status: 'gone',
    });
  });
});

describe('isDraftSessionExpired', () => {
  const updatedAt = '2026-10-04T10:00:00.000Z';
  const base = new Date(updatedAt).getTime();

  it('keeps a session alive at exactly the timeout', () => {
    expect(
      isDraftSessionExpired(
        { updated_at: updatedAt },
        base + DRAFT_SESSION_TIMEOUT_MS
      )
    ).toBe(false);
  });

  it('expires a session one millisecond past the timeout', () => {
    expect(
      isDraftSessionExpired(
        { updated_at: updatedAt },
        base + DRAFT_SESSION_TIMEOUT_MS + 1
      )
    ).toBe(true);
  });

  it('uses a one-hour timeout', () => {
    expect(DRAFT_SESSION_TIMEOUT_MS).toBe(60 * 60 * 1000);
  });
});
