import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addressIsDoNotContact } from './do-not-contact-address';

function db(rows: Record<string, unknown>[], error: unknown = null) {
  const calls: Record<string, unknown>[] = [];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      calls.push({ [column]: value });
      return builder;
    },
    like: (column: string, value: unknown) => {
      calls.push({ like: [column, value] });
      return builder;
    },
    ilike: (column: string, value: unknown) => {
      calls.push({ ilike: [column, value] });
      return builder;
    },
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error }).then(resolve),
  };
  return {
    client: { from: () => builder } as unknown as SupabaseClient,
    calls,
  };
}

describe('[CTM-021] addressIsDoNotContact', () => {
  it('matches a blocked contact by phone in any format, scoped to the account', async () => {
    const { client, calls } = db([{ phone: '+919876543210' }]);
    expect(
      await addressIsDoNotContact(client, 'acc-1', { phone: '98765 43210' })
    ).toBe(true);
    expect(calls).toContainEqual({ account_id: 'acc-1' });
    expect(calls).toContainEqual({ do_not_contact: true });
    expect(calls).toContainEqual({ like: ['phone', '%76543210'] });
  });

  it('ignores a blocked row with a different number', async () => {
    const { client } = db([{ phone: '+919812345678' }]);
    expect(
      await addressIsDoNotContact(client, 'acc-1', { phone: '+919876543210' })
    ).toBe(false);
  });

  it('matches a blocked contact by email, escaping wildcards', async () => {
    const { client, calls } = db([{ id: 'c1' }]);
    expect(
      await addressIsDoNotContact(client, 'acc-1', { email: ' a_b@x.com ' })
    ).toBe(true);
    expect(calls).toContainEqual({ ilike: ['email', 'a\\_b@x.com'] });
  });

  it('reports null on a lookup error so the caller refuses', async () => {
    const { client } = db([], { message: 'boom' });
    expect(
      await addressIsDoNotContact(client, 'acc-1', { phone: '+919876543210' })
    ).toBeNull();
  });

  it('is false for an empty address', async () => {
    const { client } = db([{ phone: '+919876543210' }]);
    expect(await addressIsDoNotContact(client, 'acc-1', {})).toBe(false);
  });
});
