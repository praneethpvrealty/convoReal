import { describe, expect, it } from 'vitest';

import { hideSameReasonMatches } from '@/lib/inventory/same-reason-marks';
import type { MatchRejectReason } from '@/lib/match-feedback';
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

const args = (
  optionIds: string[],
  classification = 'Buyer',
  reason: MatchRejectReason = 'type',
  marked: Partial<Contact> = {}
) => ({
  accountId: 'acc-1',
  userId: 'user-1',
  property: duplex,
  contact: buyer('lakshman', { classification, ...marked }),
  reason,
  optionIds,
});

const rows = (calls: Call[]) =>
  (
    (calls.find((c) => c.op === 'upsert')?.args[0] ?? []) as {
      contact_id: string;
      reason: string;
    }[]
  )
    .map((r) => `${r.contact_id}:${r.reason}`)
    .sort();

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
    expect(await hideSameReasonMatches(db, args(['pt_apartment']))).toBe(2);

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

  it('keeps a contact one of whose briefs wants another type or states a wider category', async () => {
    const { db, calls } = fakeDb([
      buyer('two-briefs', {
        pref_property_types: [],
        requirement_profiles: [
          {
            id: 'flat',
            raw_text: '3bhk flat on Sarjapur Road',
            active: true,
            property_types: ['Flat/ Apartment'],
            property_categories: [],
            areas: ['Sarjapur Road'],
          },
          {
            id: 'villa',
            raw_text: 'Villa on Sarjapur Road',
            active: true,
            property_types: ['Villa'],
            property_categories: [],
            areas: ['Sarjapur Road'],
          },
        ],
      } as unknown as Partial<Contact>),
      buyer('residential-brief', {
        pref_property_types: [],
        requirement_profiles: [
          {
            id: 'flat',
            raw_text: '3bhk flat on Sarjapur Road',
            active: true,
            property_types: ['Flat/ Apartment'],
            property_categories: [],
            areas: ['Sarjapur Road'],
          },
          {
            id: 'any-home',
            raw_text: 'Any home on Sarjapur Road',
            active: true,
            property_types: [],
            property_categories: ['residential'],
            areas: ['Sarjapur Road'],
          },
        ],
      } as unknown as Partial<Contact>),
      buyer('commercial-too', {
        pref_property_types: ['Flat/ Apartment'],
        pref_property_categories: ['commercial'],
      }),
      buyer('omi', { pref_property_types: ['Flat/ Apartment'] }),
    ]);
    expect(await hideSameReasonMatches(db, args(['pt_apartment']))).toBe(1);
    const rows = calls.find((c) => c.op === 'upsert')?.args[0] as {
      contact_id: string;
    }[];
    expect(rows.map((r) => r.contact_id)).toEqual(['omi']);
  });

  it('counts only the marks it wrote, so an answer already on file stays', async () => {
    const { db } = fakeDb(
      [
        buyer('omi', { pref_property_types: ['Flat/ Apartment'] }),
        buyer('harsha', { pref_property_types: ['Flat/ Apartment'] }),
      ],
      (rows) => rows.slice(0, 1)
    );
    expect(await hideSameReasonMatches(db, args(['pt_apartment']))).toBe(1);
  });

  it('touches no one when the contact is outside the match lists or no type was named', async () => {
    const pool = [buyer('omi', { pref_property_types: ['Flat/ Apartment'] })];
    const owner = fakeDb(pool);
    expect(
      await hideSameReasonMatches(owner.db, args(['pt_apartment'], 'Owner'))
    ).toBe(0);
    const none = fakeDb(pool);
    expect(await hideSameReasonMatches(none.db, args([]))).toBe(0);
    expect([...owner.calls, ...none.calls]).toHaveLength(0);
  });

  it('writes nothing when no other match wants only that type', async () => {
    const { db, calls } = fakeDb([buyer('open')]);
    expect(await hideSameReasonMatches(db, args(['pt_apartment']))).toBe(0);
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });
});

describe('[PRP-051] a location mark hides every match who names only the same areas', () => {
  it('marks the other Sarjapur Road-only buyers and leaves wider ones', async () => {
    const flat = { pref_property_types: ['Flat/ Apartment'] };
    const { db, calls } = fakeDb([
      buyer('omi', flat),
      buyer('harsha', { ...flat, areas_of_interest: ['Sarjapur Road.'] }),
      buyer('wider', { ...flat, pref_areas: ['Sarjapur Road', 'HSR Layout'] }),
      buyer('project', { ...flat, pref_projects: ['SJR Blue Waters'] }),
      buyer('anywhere', { ...flat, pref_areas: [] }),
      buyer('open', { ...flat, pref_areas: ['Sarjapur Road', 'Anywhere'] }),
      buyer('yield', { ...flat, min_roi: 4 }),
      buyer('text-open', {
        ...flat,
        requirements: 'Flat on Sarjapur Road, any location is fine',
      }),
    ]);
    expect(
      await hideSameReasonMatches(db, args([], 'Buyer', 'location', flat))
    ).toBe(2);
    expect(rows(calls)).toEqual(['harsha:location', 'omi:location']);
  });

  it('hides no one when the marked contact names no area', async () => {
    const { db, calls } = fakeDb([buyer('omi')]);
    expect(
      await hideSameReasonMatches(
        db,
        args([], 'Buyer', 'location', { pref_areas: [] })
      )
    ).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('[PRP-051] a budget mark hides every match whose budget stops where theirs does', () => {
  it('on a listing above the ceiling, hides those topping out no higher', async () => {
    const { db, calls } = fakeDb([
      buyer('lower', { pref_budget_max: 86_000_000 }),
      buyer('same', { max_budget: 87_000_000 }),
      buyer('higher', { pref_budget_max: 120_000_000 }),
      buyer('flexible', { no_budget: true }),
      buyer('per-sqft', {
        requirements: 'Flat on Sarjapur Road around 9500 per sqft',
        pref_budget_max: 9_500,
      }),
      buyer('unknown'),
    ]);
    expect(
      await hideSameReasonMatches(
        db,
        args([], 'Buyer', 'budget', { pref_budget_max: 87_000_000 })
      )
    ).toBe(2);
    expect(rows(calls)).toEqual(['lower:budget', 'same:budget']);
  });

  it('on a listing below the floor, hides those starting no lower', async () => {
    const { db, calls } = fakeDb([
      buyer('higher-floor', {
        pref_budget_min: 110_000_000,
        pref_budget_max: 160_000_000,
      }),
      buyer('lower-floor', {
        pref_budget_min: 80_000_000,
        pref_budget_max: 160_000_000,
      }),
    ]);
    expect(
      await hideSameReasonMatches(
        db,
        args([], 'Buyer', 'budget', {
          pref_budget_min: 100_000_000,
          pref_budget_max: 150_000_000,
        })
      )
    ).toBe(1);
    expect(rows(calls)).toEqual(['higher-floor:budget']);
  });

  it('hides no one when the marked contact has no budget on file', async () => {
    const { db, calls } = fakeDb([buyer('lower', { pref_budget_max: 9e7 })]);
    expect(await hideSameReasonMatches(db, args([], 'Buyer', 'budget'))).toBe(
      0
    );
    expect(calls).toHaveLength(0);
  });

  it('hides no one for a reason that names nothing to compare', async () => {
    const { db, calls } = fakeDb([buyer('omi')]);
    expect(await hideSameReasonMatches(db, args([], 'Buyer', 'not_now'))).toBe(
      0
    );
    expect(calls).toHaveLength(0);
  });
});
