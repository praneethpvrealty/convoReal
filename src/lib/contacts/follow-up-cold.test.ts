import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const closed: Array<{ contactId: string; propertyId: string }> = [];
let openByContact: Record<string, Array<{ id: string; title: string }>> = {};
let enquiryReadFails = false;
let closeFails = false;
let coolFails = false;
let repointFails = false;
let enquiryReadsBeforeFailure = 0;

vi.mock('@/lib/whatsapp/enquiry-review', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/enquiry-review')>();
  return {
    ...actual,
    closePropertyEnquiry: vi.fn(
      async (args: { contact: { id: string }; property: { id: string } }) => {
        if (closeFails) return false;
        closed.push({
          contactId: args.contact.id,
          propertyId: args.property.id,
        });
        return true;
      }
    ),
    loadOpenEnquiries: vi.fn(
      async (
        _db: unknown,
        _accountId: string,
        contactId: string,
        opts: { strict?: boolean; excludePropertyId?: string } = {}
      ) => {
        if (enquiryReadFails && opts.strict) {
          if (enquiryReadsBeforeFailure === 0) throw new Error('timeout');
          enquiryReadsBeforeFailure -= 1;
        }
        return (openByContact[contactId] ?? [])
          .filter(
            (p) =>
              p.id !== opts.excludePropertyId &&
              !closed.some(
                (c) => c.contactId === contactId && c.propertyId === p.id
              )
          )
          .map((property) => ({ itemId: `item-${property.id}`, property }));
      }
    ),
  };
});

import { markFollowUpCold } from './follow-up-nudges';

// Rohit enquired on a JP Nagar plot and a Yelahanka house. The agent
// tapped Mark cold on the JP Nagar card; that used to set the whole
// contact COLD, and the radar stopped following the house too.

type Update = { patch: Record<string, unknown>; filters: string[] };

function fakeDb(
  properties: Array<{ id: string; title: string }>,
  lookupError: { message: string } | null = null,
  lingering: Array<{ id: string }> = []
) {
  const updates: Update[] = [];
  const db = {
    from(table: string) {
      const filters: string[] = [];
      let patch: Record<string, unknown> | null = null;
      let id: string | null = null;
      const chain = {
        select: () => chain,
        limit: () => chain,
        update: (p: Record<string, unknown>) => {
          patch = p;
          return chain;
        },
        eq: (column: string, value: string) => {
          if (column === 'id') id = value;
          filters.push(`${column}=${value}`);
          return chain;
        },
        in: (column: string, values: string[]) => {
          filters.push(`${column} in ${values.join(',')}`);
          return chain;
        },
        maybeSingle: async () => ({
          error: table === 'properties' ? lookupError : null,
          data:
            table === 'properties'
              ? (properties.find((p) => p.id === id) ?? null)
              : null,
        }),
        then: (resolve: (v: { data: unknown; error?: unknown }) => void) => {
          if (patch) updates.push({ patch, filters });
          if (
            repointFails &&
            table === 'contacts' &&
            patch &&
            'last_inquired_property_id' in patch
          ) {
            resolve({ data: null, error: { message: 'timeout' } });
            return;
          }
          resolve({
            data:
              table === 'journey_items'
                ? lingering
                : table === 'contacts' && patch && !coolFails
                  ? [{ id: 'row' }]
                  : null,
          });
        },
      };
      return chain;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, updates };
}

const PLOT = { id: 'p-plot', title: 'JP Nagar Plot' };
const HOUSE = { id: 'p-house', title: 'Yelahanka House' };

describe('[INB-021] markFollowUpCold', () => {
  beforeEach(() => {
    closed.length = 0;
    openByContact = {};
    enquiryReadFails = false;
    closeFails = false;
    coolFails = false;
    repointFails = false;
    enquiryReadsBeforeFailure = 0;
  });

  it('closes only the carded listing and keeps the lead hot on the rest', async () => {
    openByContact = { rohit: [PLOT, HOUSE] };
    const { db, updates } = fakeDb([PLOT, HOUSE]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['rohit'],
      propertyId: PLOT.id,
    });

    expect(closed).toEqual([{ contactId: 'rohit', propertyId: PLOT.id }]);
    expect(outcome).toMatchObject({ scope: 'property', stillOpen: [HOUSE] });
    expect(updates.some((u) => 'lead_temp' in u.patch)).toBe(false);
    expect(updates).toEqual([
      expect.objectContaining({
        patch: expect.objectContaining({ last_inquired_property_id: HOUSE.id }),
        filters: expect.arrayContaining([
          `last_inquired_property_id=${PLOT.id}`,
          'account_id=acct-1',
        ]),
      }),
    ]);
  });

  it('closes the listing for everyone buying together', async () => {
    openByContact = { husband: [PLOT], wife: [PLOT, HOUSE] };
    const { db } = fakeDb([PLOT, HOUSE]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['husband', 'wife'],
      propertyId: PLOT.id,
    });

    expect(closed.map((c) => c.contactId)).toEqual(['husband', 'wife']);
    expect(outcome).toMatchObject({ scope: 'property', stillOpen: [HOUSE] });
  });

  it('marks the lead cold once the carded listing was the last open enquiry', async () => {
    openByContact = { rohit: [PLOT] };
    const { db, updates } = fakeDb([PLOT]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['rohit'],
      propertyId: PLOT.id,
    });

    expect(closed).toHaveLength(1);
    expect(outcome).toMatchObject({ scope: 'lead', property: PLOT });
    expect(updates).toEqual([
      expect.objectContaining({
        patch: expect.objectContaining({ lead_temp: 'COLD' }),
      }),
    ]);
  });

  it.each([
    ['deleted', null],
    ['unreadable', { message: 'timeout' }],
  ])(
    'changes nothing when the carded listing is %s',
    async (_label, lookupError) => {
      openByContact = { rohit: [PLOT, HOUSE] };
      const { db, updates } = fakeDb(
        lookupError ? [PLOT, HOUSE] : [HOUSE],
        lookupError
      );

      const outcome = await markFollowUpCold(db, {
        accountId: 'acct-1',
        partyIds: ['rohit'],
        propertyId: PLOT.id,
      });

      expect(outcome).toEqual({ scope: 'unresolved' });
      expect(closed).toHaveLength(0);
      expect(updates).toHaveLength(0);
    }
  );

  it('changes nothing when the open enquiries cannot be read', async () => {
    openByContact = { rohit: [PLOT, HOUSE] };
    enquiryReadFails = true;
    const { db, updates } = fakeDb([PLOT, HOUSE]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['rohit'],
      propertyId: PLOT.id,
    });

    expect(outcome).toEqual({ scope: 'unresolved' });
    expect(closed).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('keeps the lead hot on the earlier read when the re-read after the close fails', async () => {
    openByContact = { rohit: [PLOT, HOUSE] };
    enquiryReadFails = true;
    enquiryReadsBeforeFailure = 1;
    const { db, updates } = fakeDb([PLOT, HOUSE]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['rohit'],
      propertyId: PLOT.id,
    });

    expect(closed).toEqual([{ contactId: 'rohit', propertyId: PLOT.id }]);
    expect(outcome).toMatchObject({ scope: 'property', stillOpen: [HOUSE] });
    expect(updates.some((u) => 'lead_temp' in u.patch)).toBe(false);
  });

  it('keeps the lead temperature and reports an unfinished close', async () => {
    openByContact = { rohit: [PLOT] };
    const { db, updates } = fakeDb([PLOT], null, [{ id: 'item-p-plot' }]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['rohit'],
      propertyId: PLOT.id,
    });

    expect(outcome).toEqual({ scope: 'incomplete', property: PLOT });
    expect(
      readFileSync(
        join(process.cwd(), 'src/lib/contacts/follow-up-nudges.ts'),
        'utf8'
      )
    ).not.toContain(".in('contact_id', partyIds)");
    expect(updates).toHaveLength(0);
  });

  it('reports an unfinished close when a party member could not be closed', async () => {
    openByContact = { rohit: [PLOT] };
    closeFails = true;
    const { db, updates } = fakeDb([PLOT]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['rohit'],
      propertyId: PLOT.id,
    });

    expect(outcome).toEqual({ scope: 'incomplete', property: PLOT });
    expect(updates).toHaveLength(0);
  });

  it('does not confirm cold when the temperature update changes no lead', async () => {
    coolFails = true;
    const { db } = fakeDb([]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['rohit'],
      propertyId: null,
    });

    expect(outcome).toEqual({ scope: 'incomplete', property: null });
  });

  it('says the listing closed but the lead was not moved when repointing fails', async () => {
    openByContact = { rohit: [PLOT, HOUSE] };
    repointFails = true;
    const { db } = fakeDb([PLOT, HOUSE]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['rohit'],
      propertyId: PLOT.id,
    });

    expect(closed).toEqual([{ contactId: 'rohit', propertyId: PLOT.id }]);
    expect(outcome).toEqual({ scope: 'unmoved', property: PLOT, next: HOUSE });
  });

  it('marks the lead cold when the card named no listing', async () => {
    const { db, updates } = fakeDb([]);

    const outcome = await markFollowUpCold(db, {
      accountId: 'acct-1',
      partyIds: ['rohit'],
      propertyId: null,
    });

    expect(closed).toHaveLength(0);
    expect(outcome).toEqual({ scope: 'lead', property: null });
    expect(updates[0].patch).toMatchObject({ lead_temp: 'COLD' });
  });
});
