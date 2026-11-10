import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/notifications/create', () => ({
  createNotification: vi.fn(),
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notifications/create';
import { fileOwnerCallback, requestedCallTime } from './owner-callback';

const OWNER_MESSAGE =
  'Hi we will discuss regarding the above property 2 Acre 4 guntas & 3 acre IVC road...call me after 10.00 a.m today';
const NOW = new Date('2026-11-10T02:32:14.000Z');

function fakeDb(
  openCallbacks: { id: string }[],
  insertError: unknown = null,
  updateError: unknown = null
) {
  const inserted: Record<string, unknown>[] = [];
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'ilike', 'gte']) {
    query[method] = vi.fn(() => query);
  }
  query.limit = vi.fn(async () => ({ data: openCallbacks, error: null }));
  const updated: Record<string, unknown>[] = [];
  query.update = vi.fn((row: Record<string, unknown>) => {
    updated.push(row);
    return {
      eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: updateError })) })),
    };
  });
  query.insert = vi.fn(async (row: Record<string, unknown>) => {
    inserted.push(row);
    return { error: insertError };
  });
  return {
    db: { from: vi.fn(() => query) } as unknown as SupabaseClient,
    inserted,
    updated,
    query,
  };
}

const args = {
  accountId: 'acc-1',
  userId: 'owner-user',
  agentUserId: 'agent-user',
  contactId: 'contact-1',
  contactName: 'Chamraju',
  contactPhone: '919900000002',
  conversationId: 'conv-1',
  text: OWNER_MESSAGE,
  listingTitles: ['2 Acres 4 Guntas Land', '3 Acre Residential Converted Land'],
  now: NOW,
};

describe('[CNV-014] requestedCallTime', () => {
  it('reads the time an owner names as IST today', () => {
    const requested = requestedCallTime(OWNER_MESSAGE, NOW);
    expect(requested?.at.toISOString()).toBe('2026-11-10T04:30:00.000Z');
    expect(requested?.label).toBe('after 10:00 am today');
  });

  it('reads tomorrow and an afternoon time', () => {
    const requested = requestedCallTime('Call me tomorrow at 4.30 pm', NOW);
    expect(requested?.at.toISOString()).toBe('2026-11-11T11:00:00.000Z');
    expect(requested?.label).toBe('at 4:30 pm tomorrow');
  });

  it('never reads a land size or a past time as a call time', () => {
    expect(requestedCallTime('2 Acre 4 guntas & 3 acre, call me', NOW)).toBe(
      null
    );
    expect(requestedCallTime('call me at 7 am', NOW)).toBe(null);
  });
});

describe('[CNV-014] fileOwnerCallback', () => {
  beforeEach(() => {
    vi.mocked(createNotification).mockReset();
  });

  it('files a to-do for the agent at the requested time and alerts them', async () => {
    const { db, inserted } = fakeDb([]);
    const result = await fileOwnerCallback(db, args);

    expect(result).toEqual({ filed: true, when: 'after 10:00 am today' });
    expect(inserted).toEqual([
      expect.objectContaining({
        account_id: 'acc-1',
        assigned_to: 'agent-user',
        contact_id: 'contact-1',
        title: 'Call back Chamraju (owner) about their listings',
        due_date: '2026-11-10T04:30:00.000Z',
        priority: 'high',
        source: 'system',
      }),
    ]);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'agent-user',
        title: 'Call back Chamraju (owner) after 10:00 am today',
        entityId: 'conv-1',
      })
    );
  });

  it('is due within the hour when no time is named', async () => {
    const { db, inserted } = fakeDb([]);
    const result = await fileOwnerCallback(db, {
      ...args,
      text: 'Please call me',
    });
    expect(result).toEqual({ filed: true, when: null });
    expect(inserted[0].due_date).toBe('2026-11-10T03:32:14.000Z');
  });

  it('moves an open owner call-back to a newly named time instead of filing twice', async () => {
    const { db, inserted, updated, query } = fakeDb([{ id: 'todo-1' }]);
    const result = await fileOwnerCallback(db, args);
    expect(query.ilike).toHaveBeenCalledWith('title', 'Call back % (owner)%');
    expect(result).toEqual({ filed: true, when: 'after 10:00 am today' });
    expect(updated).toEqual([{ due_date: '2026-11-10T04:30:00.000Z' }]);
    expect(inserted).toEqual([]);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('confirms no time for a repeat request that names none', async () => {
    const { db, inserted, updated } = fakeDb([{ id: 'todo-1' }]);
    const result = await fileOwnerCallback(db, {
      ...args,
      text: 'Please call me',
    });
    expect(result).toEqual({ filed: true, when: null });
    expect(updated).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it('confirms no time when the open call-back could not be moved', async () => {
    const { db } = fakeDb([{ id: 'todo-1' }], null, { message: 'refused' });
    const result = await fileOwnerCallback(db, args);
    expect(result).toEqual({ filed: true, when: null });
  });

  it('reports a call-back it could not file, and still alerts the agent', async () => {
    const { db } = fakeDb([], { message: 'insert refused' });
    const result = await fileOwnerCallback(db, args);
    expect(result.filed).toBe(false);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});
