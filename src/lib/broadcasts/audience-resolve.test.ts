import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(),
}));

const { countAudienceOnServer, resolveAudienceOnServer } =
  await import('./sender');

type Row = Record<string, unknown>;

function digits(phone: unknown): string {
  return String(phone ?? '').replace(/\D/g, '');
}

function audienceIds(tables: Record<string, Row[]>, args: Row): string[] {
  const tagged = (tagIds: unknown) => {
    const wanted = new Set((tagIds as string[] | null) ?? []);
    return new Set(
      (tables.contact_tags ?? [])
        .filter((t) => wanted.has(t.tag_id as string))
        .map((t) => t.contact_id)
    );
  };
  const inAudience = (c: Row): boolean => {
    switch (args.p_type) {
      case 'all':
        return true;
      case 'contacts':
        return ((args.p_contact_ids as string[] | null) ?? []).includes(
          c.id as string
        );
      case 'tags':
        return tagged(args.p_tag_ids).has(c.id);
      case 'custom_field':
        return (tables.contact_custom_values ?? []).some((v) => {
          if (v.contact_id !== c.id) return false;
          if (v.custom_field_id !== args.p_field_id) return false;
          const value = String(v.value ?? '');
          const wanted = String(args.p_field_value ?? '');
          if (args.p_field_operator === 'is') return value === wanted;
          if (args.p_field_operator === 'is_not') return value !== wanted;
          if (args.p_field_operator === 'contains') {
            return value.toLowerCase().includes(wanted.toLowerCase());
          }
          return false;
        });
      default:
        return false;
    }
  };
  const excluded = tagged(args.p_exclude_tag_ids);
  return (tables.contacts ?? [])
    .filter(
      (c) =>
        c.account_id === args.p_account_id &&
        /\S/.test(String(c.phone ?? '')) &&
        c.buyer_alerts_consent !== 'declined' &&
        !c.chain_only &&
        !c.is_dead &&
        !c.is_archived &&
        (!args.p_opted_in_only || c.buyer_alerts_consent === 'granted') &&
        inAudience(c) &&
        !excluded.has(c.id)
    )
    .map((c) => c.id as string);
}

function fakeDb(tables: Record<string, Row[]>) {
  const inLengths: number[] = [];
  const inserted: Row[] = [];
  const rpcs: string[] = [];

  function query(initial: Row[], table?: string) {
    let rows = [...initial];
    let window: [number, number] | null = null;
    let created: Row[] | null = null;
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((r) => r[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        inLengths.push(values.length);
        rows = rows.filter((r) => values.includes(r[column]));
        return builder;
      },
      order: (column: string) => {
        rows = [...rows].sort((a, b) =>
          String(a[column]).localeCompare(String(b[column]))
        );
        return builder;
      },
      range: (start: number, end: number) => {
        window = [start, end];
        return builder;
      },
      insert: (newRows: Row[]) => {
        created = newRows.map((r, i) => ({
          id: `new-${inserted.length + i}`,
          ...r,
        }));
        inserted.push(...created);
        tables[table!] = [...(tables[table!] ?? []), ...created];
        return builder;
      },
      then: (
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({
          data:
            created ?? (window ? rows.slice(window[0], window[1] + 1) : rows),
          error: null,
        }).then(resolve, reject),
    };
    return builder;
  }

  function from(table: string) {
    return query(tables[table] ?? [], table);
  }

  function rpc(name: string, args: Row) {
    rpcs.push(name);
    if (name === 'broadcast_audience_contact_ids') {
      return query(audienceIds(tables, args).map((id) => ({ contact_id: id })));
    }
    if (name === 'count_broadcast_audience') {
      return Promise.resolve({
        data: audienceIds(tables, args).length,
        error: null,
      });
    }
    if (name === 'contacts_matching_phone_digits') {
      const wanted = new Set(args.p_digits as string[]);
      return query(
        (tables.contacts ?? []).filter(
          (c) =>
            c.account_id === args.p_account_id && wanted.has(digits(c.phone))
        )
      );
    }
    throw new Error(`unexpected rpc ${name}`);
  }

  return {
    db: { from, rpc } as unknown as SupabaseClient,
    inLengths,
    inserted,
    rpcs,
  };
}

function contact(id: string, extra: Row = {}): Row {
  return {
    id,
    account_id: 'a1',
    phone: `+9198765${id.replace(/\D/g, '').padStart(5, '0')}`,
    ...extra,
  };
}

describe('broadcast audience resolution', () => {
  const people = [
    contact('c1'),
    contact('c2', { phone: null, email: 'x@y.z' }),
    contact('c3', { buyer_alerts_consent: 'declined' }),
    contact('c4', { chain_only: true }),
    contact('c5', { is_dead: true }),
    contact('c6', { is_archived: true }),
    contact('c7', { buyer_alerts_consent: 'granted' }),
    contact('c8'),
    contact('other', { account_id: 'a2' }),
  ];

  it('counts exactly the contacts the sender would message', async () => {
    const tables = {
      contacts: people,
      contact_tags: [{ contact_id: 'c8', tag_id: 'vip' }],
    };
    const audience = { type: 'all' as const, excludeTagIds: ['vip'] };

    const count = await countAudienceOnServer(
      fakeDb(tables).db,
      'a1',
      audience
    );
    const resolved = await resolveAudienceOnServer(
      fakeDb(tables).db,
      'a1',
      'u1',
      audience
    );

    expect(resolved.map((c) => c.id).sort()).toEqual(['c1', 'c7']);
    expect(count).toBe(resolved.length);
  });

  it('narrows to explicit opt-ins on request', async () => {
    expect(
      await countAudienceOnServer(
        fakeDb({ contacts: people }).db,
        'a1',
        { type: 'all' },
        { optedInOnly: true }
      )
    ).toBe(1);
  });

  it('counts a custom-field audience instead of returning zero', async () => {
    const { db } = fakeDb({
      contacts: people,
      contact_custom_values: [
        { contact_id: 'c1', custom_field_id: 'city', value: 'Pune' },
        { contact_id: 'c3', custom_field_id: 'city', value: 'Pune' },
        { contact_id: 'c8', custom_field_id: 'city', value: 'Goa' },
      ],
    });
    expect(
      await countAudienceOnServer(db, 'a1', {
        type: 'custom_field',
        customField: { fieldId: 'city', operator: 'is', value: 'Pune' },
      })
    ).toBe(1);
  });

  it('counts in SQL and pages the send past 1,000 rows with bounded in-lists', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => contact(`c${i}`));
    const tables = {
      contacts: many,
      contact_tags: many.map((c) => ({ contact_id: c.id, tag_id: 't1' })),
    };

    const counting = fakeDb(tables);
    expect(
      await countAudienceOnServer(counting.db, 'a1', { type: 'all' })
    ).toBe(2500);
    expect(
      await countAudienceOnServer(counting.db, 'a1', {
        type: 'tags',
        tagIds: ['t1'],
      })
    ).toBe(2500);
    expect(counting.rpcs).toEqual([
      'count_broadcast_audience',
      'count_broadcast_audience',
    ]);
    expect(counting.inLengths).toEqual([]);

    const sending = fakeDb(tables);
    const resolved = await resolveAudienceOnServer(sending.db, 'a1', 'u1', {
      type: 'tags',
      tagIds: ['t1'],
    });
    expect(resolved).toHaveLength(2500);
    expect(Math.max(...sending.inLengths)).toBeLessThanOrEqual(300);
  });

  it('applies opted-in narrowing to the send as well as the count', async () => {
    const resolved = await resolveAudienceOnServer(
      fakeDb({ contacts: people }).db,
      'a1',
      'u1',
      { type: 'all' },
      { optedInOnly: true }
    );
    expect(resolved.map((c) => c.id)).toEqual(['c7']);
  });

  it('counts a CSV list without creating contacts, matching any phone spelling', async () => {
    const tables = {
      contacts: [
        contact('c1', { phone: '919876500001' }),
        contact('c3', {
          phone: '+919876500003',
          buyer_alerts_consent: 'declined',
        }),
      ],
    };
    const csvContacts = [
      { phone: '+919876500001' },
      { phone: '+919876500003' },
      { phone: '+919876500009', name: 'New' },
      { phone: '+91 98765 00009' },
    ];

    const counting = fakeDb(tables);
    expect(
      await countAudienceOnServer(counting.db, 'a1', {
        type: 'csv',
        csvContacts,
      })
    ).toBe(2);
    expect(counting.inserted).toEqual([]);

    const sending = fakeDb(tables);
    const resolved = await resolveAudienceOnServer(sending.db, 'a1', 'u1', {
      type: 'csv',
      csvContacts,
    });
    expect(resolved).toHaveLength(2);
    expect(sending.inserted).toHaveLength(1);
    expect(sending.inserted[0]).toMatchObject({
      name: 'New',
      phone: '+919876500009',
    });
  });

  it('matches a CSV number against a stored phone written with spaces and dashes', async () => {
    const tables = {
      contacts: [contact('c1', { phone: '+91 98765-43210' })],
    };
    const audience = {
      type: 'csv' as const,
      csvContacts: [{ phone: '9876543210' }],
    };

    const counting = fakeDb(tables);
    expect(await countAudienceOnServer(counting.db, 'a1', audience)).toBe(1);

    const sending = fakeDb(tables);
    const resolved = await resolveAudienceOnServer(
      sending.db,
      'a1',
      'u1',
      audience
    );
    expect(resolved.map((c) => c.id)).toEqual(['c1']);
    expect(sending.inserted).toEqual([]);
  });

  it.each([
    ['declined', { buyer_alerts_consent: 'declined' }],
    ['dead', { is_dead: true }],
    ['archived', { is_archived: true }],
  ])(
    'never creates a duplicate for a %s contact matched by a CSV number',
    async (_label, state) => {
      const tables = {
        contacts: [contact('c1', { phone: '+91 98765-43210', ...state })],
      };
      const audience = {
        type: 'csv' as const,
        csvContacts: [{ phone: '9876543210', name: 'Opted out' }],
      };

      const counting = fakeDb(tables);
      expect(await countAudienceOnServer(counting.db, 'a1', audience)).toBe(0);

      const sending = fakeDb(tables);
      expect(
        await resolveAudienceOnServer(sending.db, 'a1', 'u1', audience)
      ).toEqual([]);
      expect(sending.inserted).toEqual([]);
      expect(tables.contacts).toHaveLength(1);
    }
  );

  it('holds back a CSV number when any contact sharing it has opted out', async () => {
    const tables = {
      contacts: [
        contact('c1', { phone: '09876543210' }),
        contact('c2', {
          phone: '(+91) 98765 43210',
          buyer_alerts_consent: 'declined',
        }),
        contact('c3', { phone: '+919876500003' }),
        contact('c4', { phone: '9876500003', is_merged: true }),
      ],
    };
    const audience = {
      type: 'csv' as const,
      csvContacts: [{ phone: '+919876543210' }, { phone: '+919876500003' }],
    };

    expect(await countAudienceOnServer(fakeDb(tables).db, 'a1', audience)).toBe(
      1
    );
    const sending = fakeDb(tables);
    const resolved = await resolveAudienceOnServer(
      sending.db,
      'a1',
      'u1',
      audience
    );
    expect(resolved.map((c) => c.id)).toEqual(['c3']);
    expect(sending.inserted).toEqual([]);
  });

  it('applies tag exclusions to matched CSV contacts but counts new ones', async () => {
    const tables = {
      contacts: [contact('c1', { phone: '+91 98765 00001' })],
      contact_tags: [{ contact_id: 'c1', tag_id: 'vip' }],
    };
    const audience = {
      type: 'csv' as const,
      csvContacts: [{ phone: '+919876500001' }, { phone: '+919876500002' }],
      excludeTagIds: ['vip'],
    };
    expect(await countAudienceOnServer(fakeDb(tables).db, 'a1', audience)).toBe(
      1
    );
    expect(
      await countAudienceOnServer(fakeDb(tables).db, 'a1', audience, {
        optedInOnly: true,
      })
    ).toBe(0);
  });
});
