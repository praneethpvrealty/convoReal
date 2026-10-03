import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadContactDetail, loadContactTags } from './detail-queries';

type Row = Record<string, unknown>;
type Result = { data: Row | Row[] | null; error: { message: string } | null };

interface Call {
  table: string;
  filters: Array<[string, unknown]>;
  terminal: 'single' | 'maybeSingle' | 'list';
}

function stubClient(resolve: (call: Call) => Result['data']) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, filters: [], terminal: 'list' };
      calls.push(call);
      const finish = (terminal: Call['terminal']) => {
        call.terminal = terminal;
        return Promise.resolve({ data: resolve(call), error: null });
      };
      const chain = {
        select: () => chain,
        order: () => chain,
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
