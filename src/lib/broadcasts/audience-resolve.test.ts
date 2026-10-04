import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(),
}));

const { countAudienceOnServer, resolveAudienceOnServer } =
  await import('./sender');

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const inLengths: number[] = [];
  const inserted: Row[] = [];

  function from(table: string) {
    let rows = [...(tables[table] ?? [])];
    let window: [number, number] | null = null;
    let created: Row[] | null = null;
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((r) => r[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        rows = rows.filter((r) => r[column] !== value);
        return builder;
      },
      ilike: (column: string, pattern: string) => {
        const needle = pattern.replace(/%/g, '').toLowerCase();
        rows = rows.filter((r) =>
          String(r[column] ?? '')
            .toLowerCase()
            .includes(needle)
        );
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        inLengths.push(values.length);
        rows = rows.filter((r) => values.includes(r[column]));
        return builder;
      },
      order: () => builder,
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
        tables[table] = [...(tables[table] ?? []), ...created];
        return builder;
      },
      then: (
        resolve: (value: { data: Row[]; error: null }) => unknown,
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

  return {
    db: { from } as unknown as SupabaseClient,
    inLengths,
    inserted,
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

  it('reads past the 1,000-row page and keeps every in-list bounded', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => contact(`c${i}`));
    const fake = fakeDb({
      contacts: many,
      contact_tags: many.map((c) => ({ contact_id: c.id, tag_id: 't1' })),
    });

    expect(await countAudienceOnServer(fake.db, 'a1', { type: 'all' })).toBe(
      2500
    );
    expect(
      await countAudienceOnServer(fake.db, 'a1', {
        type: 'tags',
        tagIds: ['t1'],
      })
    ).toBe(2500);
    expect(Math.max(...fake.inLengths)).toBeLessThanOrEqual(300);
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
    expect(sending.inserted[0]).toMatchObject({ name: 'New' });
  });
});
