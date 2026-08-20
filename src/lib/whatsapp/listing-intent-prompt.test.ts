import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

const {
  buildListingIntentSections,
  listingIntentAcknowledgement,
  sendListingIntentPrompt,
  handleListingIntentReply,
  LISTING_INTENT_ID_PREFIX,
} = await import('./listing-intent-prompt');

import { getMatchingContacts } from '@/lib/matching';
import type { Contact, Property } from '@/types';

function stubDb() {
  const updates: { table: string; patch: unknown }[] = [];
  const db = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.update = (patch: unknown) => {
        updates.push({ table, patch });
        return chain;
      };
      (chain as { then?: unknown }).then = (r: (v: unknown) => unknown) =>
        Promise.resolve(r({ data: null }));
      return chain;
    },
  } as never;
  return { db, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
});

describe('buildListingIntentSections', () => {
  it('stays within Meta list limits', () => {
    const [section] = buildListingIntentSections({ includeFormRow: true });
    expect(section.rows.length).toBeLessThanOrEqual(10);
    for (const row of section.rows) {
      expect(row.title.length).toBeLessThanOrEqual(24);
    }
  });

  it('reuses the lfb_form id so the existing form route serves this list too', () => {
    const [withForm] = buildListingIntentSections({ includeFormRow: true });
    const [without] = buildListingIntentSections();
    expect(withForm.rows.at(-1)?.id).toBe('lfb_form');
    expect(without.rows.some((r) => r.id === 'lfb_form')).toBe(false);
  });

  it('owns every id it sends, so the webhook can route them by prefix', () => {
    const [section] = buildListingIntentSections();
    for (const row of section.rows) {
      expect(row.id.startsWith(LISTING_INTENT_ID_PREFIX), row.id).toBe(true);
    }
  });
});

describe('handleListingIntentReply', () => {
  it('writes the tapped intent to the contact', async () => {
    const { db, updates } = stubDb();
    const handled = await handleListingIntentReply({
      db,
      accountId: 'acc',
      contactId: 'c1',
      replyId: 'li_rent',
    });
    expect(handled).toBe(true);
    expect(updates).toEqual([
      { table: 'contacts', patch: { pref_listing_types: ['Rent'] } },
    ]);
  });

  it('records "Either" as both halves rather than as no answer', async () => {
    const { db, updates } = stubDb();
    await handleListingIntentReply({
      db,
      accountId: 'acc',
      contactId: 'c1',
      replyId: 'li_both',
    });
    expect(updates[0].patch).toEqual({ pref_listing_types: ['Sale', 'Rent'] });
  });

  it('leaves an id it does not own to the other handlers', async () => {
    const { db, updates } = stubDb();
    const handled = await handleListingIntentReply({
      db,
      accountId: 'acc',
      contactId: 'c1',
      replyId: 'pt_apartment',
    });
    expect(handled).toBe(false);
    expect(updates).toEqual([]);
  });
});

// The written value must gate listings, not just sit in a column —
// same guarantee the property-type list carries.
describe('a tapped intent reaches the matcher', () => {
  const buyer = (types: string[]): Contact =>
    ({
      id: 'c1',
      user_id: 'u1',
      phone: '919000000000',
      classification: 'Buyer',
      pref_property_types: ['Flat/ Apartment'],
      pref_listing_types: types,
      pref_extracted_at: '2026-08-20T00:00:00Z',
      created_at: '2026-08-20T00:00:00Z',
      updated_at: '2026-08-20T00:00:00Z',
    }) as Contact;

  const flat = (listingType: string): Property =>
    ({
      id: 'p1',
      account_id: 'acc',
      user_id: 'u1',
      title: 'Flat in HSR Layout',
      type: 'Flat/ Apartment',
      listing_type: listingType,
      location: 'HSR Layout, Bangalore',
      price: 10_000_000,
      status: 'Available',
      is_published: true,
      features: [],
      images: [],
      created_at: '2026-08-20T00:00:00Z',
      updated_at: '2026-08-20T00:00:00Z',
    }) as Property;

  it('gates the half the lead did not ask for', () => {
    expect(getMatchingContacts(flat('Rent'), [buyer(['Sale'])])).toHaveLength(0);
    expect(getMatchingContacts(flat('Sale'), [buyer(['Sale'])])).toHaveLength(1);
  });

  it('keeps both halves open for the Either tap', () => {
    expect(
      getMatchingContacts(flat('Rent'), [buyer(['Sale', 'Rent'])])
    ).toHaveLength(1);
    expect(
      getMatchingContacts(flat('Sale'), [buyer(['Sale', 'Rent'])])
    ).toHaveLength(1);
  });
});

describe('sendListingIntentPrompt', () => {
  it('sends the list and acknowledges the tap it gets back', async () => {
    const { db } = stubDb();
    const sent = await sendListingIntentPrompt({
      db,
      accountId: 'acc',
      userId: 'u1',
      contactId: 'c1',
      conversationId: 'conv1',
    });
    expect(sent).toBe(true);
    const [args] = sendWhatsAppMessageAndPersist.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(args.interactiveType).toBe('list');
    expect(String(args.interactiveBody)).toMatch(/buy or to rent/i);
    expect(listingIntentAcknowledgement('li_rent')).toContain('renting');
    expect(listingIntentAcknowledgement('nonsense')).toBeNull();
  });

  it('reports failure rather than throwing when the send fails', async () => {
    const { db } = stubDb();
    sendWhatsAppMessageAndPersist.mockRejectedValueOnce(new Error('meta down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      sendListingIntentPrompt({
        db,
        accountId: 'acc',
        userId: 'u1',
        contactId: 'c1',
        conversationId: 'conv1',
      })
    ).resolves.toBe(false);
    spy.mockRestore();
  });
});
