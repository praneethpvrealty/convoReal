import { describe, expect, it } from 'vitest';

import { hideSameTypeMatches } from '@/lib/inventory/same-type-marks';
import type { Contact, Property } from '@/types';

type Call = { table: string; op: string; args: unknown[] };

const duplex = {
  id: 'p-1',
  title: '3500 Sq.Ft. Duplex Ground and First Floor',
  type: 'Flat/ Apartment',
  listing_type: 'Sale',
  price: 94_500_000,
  sublocality: 'Sarjapur Road',
  city: 'Bengaluru',
} as Property;

function buyer(id: string, overrides: Partial<Contact> = {}): Contact {
  return {
    id,
    name: id,
    phone: '919900000000',
    classification: 'Buyer',
    pref_areas: ['Sarjapur Road'],
    pref_extracted_at: '2026-10-01T00:00:00Z',
    ...overrides,
  } as Contact;
}

function fakeDb(pool: Contact[], inserted?: (rows: unknown[]) => unknown[]) {
  const calls: Call[] = [];
  const db = {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = {};
      for (const op of ['select', 'eq', 'neq', 'in', 'upsert']) {
        query[op] = (...args: unknown[]) => {
          calls.push({ table, op, args });
          return query;
        };
      }
      query.then = (resolve: (v: unknown) => unknown) => {
        const upsert = calls.findLast(
          (c) => c.table === table && c.op === 'upsert'
        );
        const data =
          table === 'contacts'
            ? pool
            : upsert
              ? (inserted ?? ((rows) => rows))(upsert.args[0] as unknown[])
              : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return query;
    },
  } as never;
  return { db, calls };
}

const args = (optionIds: string[], classification = 'Buyer') => ({
  accountId: 'acc-1',
  userId: 'user-1',
  property: duplex,
  contact: { id: 'lakshman', classification },
  optionIds,
});

describe('[PRP-051] a wrong-type answer hides every match who wants only that type', () => {
  it('marks the other flat seekers and leaves broader or type-less ones', async () => {
    const { db, calls } = fakeDb([
      buyer('omi', { pref_property_types: ['Flat/ Apartment'] }),
      buyer('sanant', {
        pref_property_types: ['Flat/ Apartment'],
        pref_property_categories: ['residential'],
      }),
      buyer('both', {
        pref_property_types: ['Flat/ Apartment', 'Villa'],
      }),
      buyer('open'),
    ]);
    expect(await hideSameTypeMatches(db, args(['pt_apartment']))).toBe(2);

    const upsert = calls.find((c) => c.op === 'upsert');
    const rows = upsert?.args[0] as Record<string, unknown>[];
    expect(rows.map((r) => r.contact_id).sort()).toEqual(['omi', 'sanant']);
    expect(rows[0]).toMatchObject({
      account_id: 'acc-1',
      property_id: 'p-1',
      verdict: 'rejected',
      reason: 'type',
      channel: 'app',
      source: 'agent',
      created_by: 'user-1',
    });
    expect(upsert?.args[1]).toEqual({
      onConflict: 'contact_id,property_id',
      ignoreDuplicates: true,
    });
    expect(calls).toContainEqual({
      table: 'contacts',
      op: 'eq',
      args: ['account_id', 'acc-1'],
    });
    expect(calls).toContainEqual({
      table: 'contacts',
      op: 'eq',
      args: ['classification', 'Buyer'],
    });
    expect(calls).toContainEqual({
      table: 'contacts',
      op: 'neq',
      args: ['id', 'lakshman'],
    });
  });

  it('counts only the marks it wrote, so an answer already on file stays', async () => {
    const { db } = fakeDb(
      [
        buyer('omi', { pref_property_types: ['Flat/ Apartment'] }),
        buyer('harsha', { pref_property_types: ['Flat/ Apartment'] }),
      ],
      (rows) => rows.slice(0, 1)
    );
    expect(await hideSameTypeMatches(db, args(['pt_apartment']))).toBe(1);
  });

  it('touches no one when the contact is outside the match lists or no type was named', async () => {
    const pool = [buyer('omi', { pref_property_types: ['Flat/ Apartment'] })];
    const owner = fakeDb(pool);
    expect(
      await hideSameTypeMatches(owner.db, args(['pt_apartment'], 'Owner'))
    ).toBe(0);
    const none = fakeDb(pool);
    expect(await hideSameTypeMatches(none.db, args([]))).toBe(0);
    expect([...owner.calls, ...none.calls]).toHaveLength(0);
  });

  it('writes nothing when no other match wants only that type', async () => {
    const { db, calls } = fakeDb([buyer('open')]);
    expect(await hideSameTypeMatches(db, args(['pt_apartment']))).toBe(0);
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });
});
