import { describe, expect, it, vi } from 'vitest';
import {
  isPropertyDisinterest,
  buildPropertyDisinterestBody,
  buildPropertyDisinterestSections,
  handlePropertyDisinterestMessage,
} from './property-disinterest';
import type { SupabaseClient } from '@supabase/supabase-js';

const journeyInterest = vi.hoisted(() => ({
  clear: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  record: vi.fn<
    (...args: unknown[]) => Promise<{ itemId: string; error: null }>
  >(async () => ({ itemId: 'ji-1', error: null })),
}));
vi.mock('@/lib/journey/lead-interest', () => ({
  clearJourneyLeadInterest: (...args: unknown[]) =>
    journeyInterest.clear(...args),
  recordJourneyLeadInterest: (...args: unknown[]) =>
    journeyInterest.record(...args),
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi
    .fn()
    .mockResolvedValue({ success: true, messageId: 'msg-123' }),
}));

vi.mock('@/lib/ai/lead-question', () => ({
  questionSubjectProperties: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/learning/subject', () => ({
  resolvePropertySubject: vi.fn().mockResolvedValue(null),
}));

describe('isPropertyDisinterest', () => {
  it.each([
    'I am not interested',
    'i am not interested',
    'Not interested',
    'not interested in this',
    "i'm not interested in this property",
    'not for me',
    'not for us',
    "don't like this",
    'dont like this property',
    'do not want this',
    'not looking for this',
    'not what I am looking for',
    'not suitable for me',
    "doesn't fit my requirement",
    'does not suit',
    "no this doesn't work",
    'pass on this',
    'drop this',
    'skip this',
    'reject this',
  ])('recognises %s as disinterest', (text) => {
    expect(isPropertyDisinterest(text)).toBe(true);
  });

  it.each([
    'I am interested in this',
    'send me photos of this property',
    'what is the price?',
    'call me tomorrow',
    'looking for 3bhk in Whitefield',
    'Property ID: PROP-1095',
    'can we visit Saturday 3pm',
    '',
    null,
    undefined,
  ])('does not flag %s as disinterest', (text) => {
    expect(isPropertyDisinterest(text)).toBe(false);
  });
});

describe('buildPropertyDisinterestBody', () => {
  it('includes contact name and property title when provided', () => {
    const body = buildPropertyDisinterestBody(
      'Ramanathan',
      'Old residential house in Koramangala'
    );
    expect(body).toContain('Understood Ramanathan —');
    expect(body).toContain('*Old residential house in Koramangala*');
    expect(body).toContain('Property Type');
    expect(body).toContain('Budget / Price');
    expect(body).toContain('Location');
    expect(body).toContain('Size / Layout');
    expect(body).toContain('reply by typing');
  });

  it('handles missing or placeholder contact name and property title gracefully', () => {
    const bodyWithPlaceholder = buildPropertyDisinterestBody(
      'Portal Lead',
      null
    );
    expect(bodyWithPlaceholder).toContain('Understood —');
    expect(bodyWithPlaceholder).toContain(
      "this property isn't what you're looking for"
    );

    const bodyWithNull = buildPropertyDisinterestBody(null, null);
    expect(bodyWithNull).toContain('Understood —');
    expect(bodyWithNull).toContain(
      "this property isn't what you're looking for"
    );
  });
});

describe('buildPropertyDisinterestSections', () => {
  it('returns structured interactive list rows for all 5 rejection factors', () => {
    const sections = buildPropertyDisinterestSections('prop-1072');
    expect(sections.length).toBe(1);
    const rows = sections[0].rows;
    expect(rows.length).toBe(5);

    expect(rows[0].id).toBe('lfbr_type_prop-1072');
    expect(rows[0].title).toContain('Wrong property type');

    expect(rows[1].id).toBe('lfbr_budget_prop-1072');
    expect(rows[1].title).toContain('Budget too high');

    expect(rows[2].id).toBe('lfbr_location_prop-1072');
    expect(rows[2].title).toContain('Wrong location');

    expect(rows[3].id).toBe('lfbr_size_prop-1072');
    expect(rows[3].title).toContain('Size or layout');

    expect(rows[4].id).toBe('lfbr_other_prop-1072');
    expect(rows[4].title).toContain('Something else');
  });
});

describe('handlePropertyDisinterestMessage recordOnly', () => {
  it('records the rejection but sends no factor prompt and leaves the message unconsumed', async () => {
    const { sendWhatsAppMessageAndPersist } =
      await import('@/lib/whatsapp/meta-api-dispatcher');
    const send = vi.mocked(sendWhatsAppMessageAndPersist);
    send.mockClear();
    const upserts: Record<string, unknown>[] = [];
    const mockDb = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'prop-1072', title: 'Bilekahalli Building' },
              }),
            }),
          }),
        }),
        upsert: vi.fn().mockImplementation((data: Record<string, unknown>) => {
          upserts.push(data);
          return Promise.resolve({ error: null });
        }),
      })),
    } as unknown as SupabaseClient;

    const handled = await handlePropertyDisinterestMessage({
      db: mockDb,
      accountId: 'acc-1',
      configOwnerUserId: 'user-1',
      contact: { id: 'contact-1', last_inquired_property_id: 'prop-1072' },
      conversationId: 'conv-1',
      inboundText: 'Not interested, please call me',
      recordOnly: true,
    });

    expect(handled).toBe(false);
    expect(upserts).toEqual([
      expect.objectContaining({
        property_id: 'prop-1072',
        verdict: 'rejected',
      }),
    ]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('handlePropertyDisinterestMessage', () => {
  it('records rejection in listing_feedback and sends interactive factor prompt', async () => {
    const calls: Array<{
      table: string;
      method: string;
      data?: Record<string, unknown>;
    }> = [];

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'prop-1072',
                  title: '5 2BHK Rental Building in Bilekahalli',
                },
              }),
            }),
          }),
        }),
        upsert: vi.fn().mockImplementation((data: Record<string, unknown>) => {
          calls.push({ table, method: 'upsert', data });
          return Promise.resolve({ error: null });
        }),
      })),
    } as unknown as SupabaseClient;

    const handled = await handlePropertyDisinterestMessage({
      db: mockDb,
      accountId: 'acc-1',
      configOwnerUserId: 'user-1',
      contact: {
        id: 'contact-1',
        name: 'Ramanathan',
        last_inquired_property_id: 'prop-1072',
      },
      conversationId: 'conv-1',
      inboundText: 'I am not interested',
    });

    expect(handled).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.table === 'listing_feedback' &&
          c.method === 'upsert' &&
          c.data?.property_id === 'prop-1072' &&
          c.data?.verdict === 'rejected'
      )
    ).toBe(true);
  });

  it('[JRN-026] keeps the stamp when the rejection could not be written', async () => {
    journeyInterest.clear.mockClear();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockDb = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'prop-1072', title: 'Rental Building' },
              }),
            }),
          }),
        }),
        upsert: vi
          .fn()
          .mockResolvedValue({ error: { message: 'connection reset' } }),
      })),
    } as unknown as SupabaseClient;

    const handled = await handlePropertyDisinterestMessage({
      db: mockDb,
      accountId: 'acc-1',
      configOwnerUserId: 'user-1',
      contact: {
        id: 'contact-1',
        name: 'Ramanathan',
        last_inquired_property_id: 'prop-1072',
      },
      conversationId: 'conv-1',
      inboundText: 'I am not interested',
    });

    expect(handled).toBe(true);
    expect(journeyInterest.clear).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[property-disinterest] feedback recording failed:',
      { message: 'connection reset' }
    );
    errorSpy.mockRestore();
  });
});

describe('handlePropertyDisinterestMessage for a listing owner', () => {
  const titles: Record<string, string> = {
    'prop-own': 'Semi-commercial Building in Koramangala',
    'prop-shared': 'Prime Commercial Site in Jayanagar',
  };

  function ownerDb(ownedIds: string[]) {
    const upserts: Record<string, unknown>[] = [];
    const db = {
      from: vi.fn().mockImplementation(() => {
        let id: string | null = null;
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: (column: string, value: string) => {
            if (column === 'id') id = value;
            return builder;
          },
          maybeSingle: async () => ({
            data: id && titles[id] ? { id, title: titles[id] } : null,
          }),
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: ownedIds.map((owned) => ({ id: owned })) }),
          upsert: (data: Record<string, unknown>) => {
            upserts.push(data);
            return Promise.resolve({ error: null });
          },
        };
        return builder;
      }),
    } as unknown as SupabaseClient;
    return { db, upserts };
  }

  it('[INB-040] never records or asks about a rejection of the contact’s own listing', async () => {
    const { sendWhatsAppMessageAndPersist } =
      await import('@/lib/whatsapp/meta-api-dispatcher');
    const send = vi.mocked(sendWhatsAppMessageAndPersist);
    send.mockClear();
    const { resolvePropertySubject } = await import('@/lib/learning/subject');
    vi.mocked(resolvePropertySubject).mockResolvedValueOnce('prop-own');
    const { db, upserts } = ownerDb(['prop-own']);

    const handled = await handlePropertyDisinterestMessage({
      db,
      accountId: 'acc-1',
      configOwnerUserId: 'user-1',
      contact: { id: 'owner-1', name: 'Narendra' },
      conversationId: 'conv-1',
      inboundText: 'Not interested',
    });

    expect(handled).toBe(false);
    expect(upserts).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('[INB-040] records the rejection on the shared listing an owner tapped Not interested on', async () => {
    const { sendWhatsAppMessageAndPersist } =
      await import('@/lib/whatsapp/meta-api-dispatcher');
    const send = vi.mocked(sendWhatsAppMessageAndPersist);
    send.mockClear();
    const { db, upserts } = ownerDb(['prop-own']);

    const handled = await handlePropertyDisinterestMessage({
      db,
      accountId: 'acc-1',
      configOwnerUserId: 'user-1',
      contact: { id: 'owner-1', name: 'Narendra' },
      conversationId: 'conv-1',
      inboundText: 'Not interested',
      quotedPropertyId: 'prop-shared',
    });

    expect(handled).toBe(true);
    expect(upserts).toEqual([
      expect.objectContaining({
        property_id: 'prop-shared',
        verdict: 'rejected',
      }),
    ]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        interactiveBody: expect.stringContaining(
          '*Prime Commercial Site in Jayanagar*'
        ),
      })
    );
  });
});

describe('[INB-045] "not interested in" a purpose is not a rejection', () => {
  it.each([
    'Not interested in Investment.',
    'This all property purchase will be registered on my name. Not interested in Investment, Just Ready to move in.',
    'not interested in renting',
    'Not interested in under construction projects',
    'not interested in leasing',
  ])('does not flag %s as disinterest', (text) => {
    expect(isPropertyDisinterest(text)).toBe(false);
  });

  it.each([
    'not interested in this',
    'Not interested in the property',
    'not interested in buying this',
    'Not interested in it, thanks',
    'Not interested. Not interested in investment either',
    'Not interested in Adarsh Palm Meadows',
    'not interested in Prestige Falcon City',
    'not interested in anything',
  ])('still recognises %s as disinterest', (text) => {
    expect(isPropertyDisinterest(text)).toBe(true);
  });
});
