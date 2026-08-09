import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

const {
  buildPropertyTypeSections,
  sendPropertyTypePrompt,
  handlePropertyTypeReply,
} = await import('./property-type-prompt');

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

describe('buildPropertyTypeSections', () => {
  it('stays within Meta list limits', () => {
    const [section] = buildPropertyTypeSections({ includeFormRow: true });
    expect(section.rows.length).toBeLessThanOrEqual(10);
    for (const row of section.rows) {
      expect(row.title.length).toBeLessThanOrEqual(24);
    }
  });

  it('reuses the lfb_form id so the existing form route serves this list too', () => {
    const [withForm] = buildPropertyTypeSections({ includeFormRow: true });
    const [without] = buildPropertyTypeSections();
    expect(withForm.rows.at(-1)?.id).toBe('lfb_form');
    expect(without.rows.some((r) => r.id === 'lfb_form')).toBe(false);
  });
});

describe('handlePropertyTypeReply', () => {
  it('writes matcher-vocabulary types the type gate actually honours', async () => {
    // The written strings must reach getMatchingContacts as a gate,
    // not decoration — proven against the real matcher: a plot buyer
    // matches a plot listing and is refused an apartment.
    const { db, updates } = stubDb();

    const handled = await handlePropertyTypeReply({
      db,
      accountId: 'acct-1',
      contactId: 'c1',
      replyId: 'pt_plot',
    });

    expect(handled).toBe(true);
    const patch = updates[0].patch as { pref_property_types: string[] };

    const buyer = {
      id: 'c1',
      pref_property_types: patch.pref_property_types,
      pref_areas: ['Koramangala'],
    } as unknown as Contact;
    const plot = {
      type: 'Residential Land/ Plot',
      price: 9_000_000,
      location: 'Koramangala',
    } as unknown as Property;
    const flat = {
      type: 'Flat/ Apartment',
      price: 9_000_000,
      location: 'Koramangala',
    } as unknown as Property;

    expect(getMatchingContacts(plot, [buyer]).length).toBe(1);
    expect(getMatchingContacts(flat, [buyer]).length).toBe(0);
  });

  it('ignores ids it does not own, so other handlers still run', async () => {
    const { db, updates } = stubDb();
    const handled = await handlePropertyTypeReply({
      db,
      accountId: 'acct-1',
      contactId: 'c1',
      replyId: 'pt_forged',
    });
    expect(handled).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe('sendPropertyTypePrompt', () => {
  it('sends as the bot through the dispatcher', async () => {
    const { db } = stubDb();
    const sent = await sendPropertyTypePrompt({
      db,
      accountId: 'acct-1',
      userId: 'u1',
      contactId: 'c1',
      conversationId: 'conv-1',
    });
    expect(sent).toBe(true);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'interactive',
        interactiveType: 'list',
        senderType: 'bot',
      })
    );
  });
});
