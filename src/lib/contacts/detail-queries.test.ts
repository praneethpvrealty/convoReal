import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PARTY_CANDIDATE_COLUMNS,
  PROPERTY_PICKER_COLUMNS,
  REFERRER_CANDIDATE_COLUMNS,
  REFERRER_SUGGESTION_LIMIT,
  loadAllProperties,
  loadContactDetail,
  loadContactTags,
  loadPartyCandidates,
  referrerSearchClauses,
  searchReferrerCandidates,
} from './detail-queries';

type Row = Record<string, unknown>;
type Result = { data: Row | Row[] | null; error: { message: string } | null };

interface Call {
  table: string;
  columns?: string;
  filters: Array<[string, unknown]>;
  excluded: Array<[string, unknown]>;
  ors: string[];
  orders: string[];
  limit?: number;
  terminal: 'single' | 'maybeSingle' | 'list';
}

function stubClient(resolve: (call: Call) => Result['data']) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = {
        table,
        filters: [],
        excluded: [],
        ors: [],
        orders: [],
        terminal: 'list',
      };
      calls.push(call);
      const finish = (terminal: Call['terminal']) => {
        call.terminal = terminal;
        return Promise.resolve({ data: resolve(call), error: null });
      };
      const chain = {
        select: (columns: string) => {
          call.columns = columns;
          return chain;
        },
        order: (column: string) => {
          call.orders.push(column);
          return chain;
        },
        limit: (count: number) => {
          call.limit = count;
          return chain;
        },
        or: (expression: string) => {
          call.ors.push(expression);
          return chain;
        },
        neq: (column: string, value: unknown) => {
          call.excluded.push([column, value]);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        in: (column: string, value: unknown) => {
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

const CONTACT = {
  id: 'c1',
  name: 'Meera',
  last_inquired_property_id: 'p1',
  lead_portal: 'magicbricks',
  lead_portal_listing_id: 'mb-99',
};

describe('loadContactDetail', () => {
  it('bundles the contact, its inquired property, the portal link and the inquiry list', async () => {
    const { client, calls } = stubClient((call) => {
      switch (call.table) {
        case 'contacts':
          return CONTACT;
        case 'properties':
          return call.terminal === 'maybeSingle'
            ? { id: 'p1', title: 'Lake View' }
            : [
                { id: 'p1', title: 'Lake View' },
                { id: 'p2', title: 'Hill View' },
              ];
        case 'property_portal_listings':
          return { property_id: 'p1' };
        case 'contact_property_inquiries':
          return [{ property_id: 'p1' }, { property_id: 'p2' }];
        default:
          return null;
      }
    });

    const bundle = await loadContactDetail(client, 'c1');

    expect(bundle.contact).toEqual(CONTACT);
    expect(bundle.inquiredProperty).toEqual({ id: 'p1', title: 'Lake View' });
    expect(bundle.portalAdLink).toEqual({ property_id: 'p1' });
    expect(bundle.inquiredProperties.map((p) => p.id)).toEqual(['p1', 'p2']);

    expect(calls.map((c) => c.table)).toEqual([
      'contacts',
      'properties',
      'property_portal_listings',
      'contact_property_inquiries',
      'properties',
    ]);
    expect(calls[2].filters).toEqual([
      ['portal', 'magicbricks'],
      ['portal_listing_id', 'mb-99'],
    ]);
    expect(calls[4].filters).toEqual([['id', ['p1', 'p2']]]);
  });

  it('falls back to the alias table only when the primary listing is unmapped', async () => {
    const { client, calls } = stubClient((call) => {
      switch (call.table) {
        case 'contacts':
          return { ...CONTACT, last_inquired_property_id: null };
        case 'property_portal_listings':
          return null;
        case 'property_portal_listing_aliases':
          return { property_id: 'p7' };
        case 'contact_property_inquiries':
          return [];
        default:
          return null;
      }
    });

    const bundle = await loadContactDetail(client, 'c1');

    expect(bundle.inquiredProperty).toBeNull();
    expect(bundle.portalAdLink).toEqual({ property_id: 'p7' });
    expect(bundle.inquiredProperties).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual([
      'contacts',
      'property_portal_listings',
      'property_portal_listing_aliases',
      'contact_property_inquiries',
    ]);
  });

  it('skips the portal lookup when the lead did not quote a portal ad', async () => {
    const { client, calls } = stubClient((call) => {
      switch (call.table) {
        case 'contacts':
          return {
            id: 'c1',
            last_inquired_property_id: null,
            lead_portal: null,
            lead_portal_listing_id: null,
          };
        case 'contact_property_inquiries':
          return null;
        default:
          return null;
      }
    });

    const bundle = await loadContactDetail(client, 'c1');

    expect(bundle.portalAdLink).toBeNull();
    expect(bundle.inquiredProperties).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual([
      'contacts',
      'contact_property_inquiries',
    ]);
  });

  it('throws when the contact is missing so a refetch keeps the last loaded bundle', async () => {
    const { client } = stubClient(() => null);
    await expect(loadContactDetail(client, 'gone')).rejects.toThrow();
  });
});

describe('loadContactTags', () => {
  it('returns every tag with the applied ids snapshotted as the pinned order', async () => {
    const { client, calls } = stubClient((call) =>
      call.table === 'tags'
        ? [
            { id: 't1', name: 'Hot' },
            { id: 't2', name: 'NRI' },
          ]
        : [{ tag_id: 't2' }]
    );

    const bundle = await loadContactTags(client, 'c1');

    expect(bundle).toEqual({
      allTags: [
        { id: 't1', name: 'Hot' },
        { id: 't2', name: 'NRI' },
      ],
      contactTagIds: ['t2'],
      pinnedTagIds: ['t2'],
    });
    expect(calls.find((c) => c.table === 'contact_tags')?.filters).toEqual([
      ['contact_id', 'c1'],
    ]);
  });

  it('yields empty lists when neither read returns rows', async () => {
    const { client } = stubClient(() => null);
    expect(await loadContactTags(client, 'c1')).toEqual({
      allTags: [],
      contactTagIds: [],
      pinnedTagIds: [],
    });
  });
});

describe('loadAllProperties', () => {
  it('selects the picker column list, not every column', async () => {
    const { client, calls } = stubClient(() => [{ id: 'p1', title: 'A' }]);

    expect(await loadAllProperties(client)).toEqual([{ id: 'p1', title: 'A' }]);
    expect(calls[0].table).toBe('properties');
    expect(calls[0].columns).toBe(PROPERTY_PICKER_COLUMNS);
    expect(calls[0].columns).not.toContain('*');
    expect(calls[0].orders).toEqual(['title']);
    expect(calls[0].limit).toBeUndefined();
  });

  it('carries every field the pickers, dialogs and chat scan read', () => {
    const columns = PROPERTY_PICKER_COLUMNS.split(', ');
    for (const field of [
      'id',
      'title',
      'property_code',
      'location',
      'sublocality',
      'city',
      'state',
      'project',
      'tags',
      'price',
      'type',
      'status',
      'bedrooms',
      'area_sqft',
      'area_unit',
      'images',
    ]) {
      expect(columns).toContain(field);
    }
    expect(columns).not.toContain('description');
    expect(columns).not.toContain('documents');
  });
});

describe('referrerSearchClauses', () => {
  it('matches each word against first name, second name or phone', () => {
    expect(referrerSearchClauses('  Meera  ')).toEqual([
      'name.ilike."%Meera%",second_name.ilike."%Meera%",phone.ilike."%Meera%"',
    ]);
    expect(referrerSearchClauses('meera rao')).toEqual([
      'name.ilike."%meera%",second_name.ilike."%meera%",phone.ilike."%meera%"',
      'name.ilike."%rao%",second_name.ilike."%rao%",phone.ilike."%rao%"',
    ]);
  });

  it('keeps PostgREST and LIKE metacharacters from reshaping the filter', () => {
    expect(referrerSearchClauses('a,b(c)')).toEqual([
      'name.ilike."%a%",second_name.ilike."%a%",phone.ilike."%a%"',
      'name.ilike."%b%",second_name.ilike."%b%",phone.ilike."%b%"',
      'name.ilike."%c%",second_name.ilike."%c%",phone.ilike."%c%"',
    ]);
    expect(referrerSearchClauses('50%')).toEqual([
      'name.ilike."%50%",second_name.ilike."%50%",phone.ilike."%50%"',
    ]);
    expect(referrerSearchClauses('a_b')).toEqual([
      'name.ilike."%a\\\\_b%",second_name.ilike."%a\\\\_b%",phone.ilike."%a\\\\_b%"',
    ]);
    expect(referrerSearchClauses('x"y\\z')).toEqual([
      'name.ilike."%x%",second_name.ilike."%x%",phone.ilike."%x%"',
      'name.ilike."%y%",second_name.ilike."%y%",phone.ilike."%y%"',
      'name.ilike."%z%",second_name.ilike."%z%",phone.ilike."%z%"',
    ]);
  });

  it('yields nothing for a term with no searchable characters', () => {
    expect(referrerSearchClauses('   ')).toEqual([]);
    expect(referrerSearchClauses('%(),*')).toEqual([]);
  });
});

describe('searchReferrerCandidates', () => {
  it('searches the account, excludes the open contact and caps the suggestions', async () => {
    const rows = [{ id: 'c2', name: 'Meera', phone: '+919800000001' }];
    const { client, calls } = stubClient(() => rows);

    const result = await searchReferrerCandidates(
      client,
      'acct-1',
      'meera rao',
      'c1'
    );

    expect(result).toEqual(rows);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('contacts');
    expect(calls[0].columns).toBe(REFERRER_CANDIDATE_COLUMNS);
    expect(calls[0].filters).toEqual([['account_id', 'acct-1']]);
    expect(calls[0].excluded).toEqual([['id', 'c1']]);
    expect(calls[0].ors).toEqual(referrerSearchClauses('meera rao'));
    expect(calls[0].orders).toEqual(['name']);
    expect(calls[0].limit).toBe(REFERRER_SUGGESTION_LIMIT);
    expect(REFERRER_SUGGESTION_LIMIT).toBe(5);
  });

  it('skips the read when the term has nothing to search for', async () => {
    const { client, calls } = stubClient(() => []);
    expect(
      await searchReferrerCandidates(client, 'acct-1', ' , ', 'c1')
    ).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('reads only the columns the suggestion list renders', () => {
    expect(REFERRER_CANDIDATE_COLUMNS.split(', ').sort()).toEqual(
      [
        'classification',
        'id',
        'name',
        'name_tag',
        'phone',
        'second_name',
      ].sort()
    );
  });
});

describe('loadPartyCandidates', () => {
  it('loads the account book with only the picker columns', async () => {
    const { client, calls } = stubClient(() => [{ id: 'c2', name: 'Ravi' }]);

    expect(await loadPartyCandidates(client, 'acct-1')).toEqual([
      { id: 'c2', name: 'Ravi' },
    ]);
    expect(calls[0].table).toBe('contacts');
    expect(calls[0].columns).toBe(PARTY_CANDIDATE_COLUMNS);
    expect(calls[0].filters).toEqual([['account_id', 'acct-1']]);
    expect(calls[0].orders).toEqual(['name']);
  });
});
