import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountPropertyShowcaseUrl: vi.fn(),
}));

import { accountPropertyShowcaseUrl } from '@/lib/showcase/account-showcase-url';
import {
  listingLinkAlreadySent,
  withListingLink,
} from '@/lib/whatsapp/listing-link-reply';

let rows: { content_text: string | null }[] = [];
let orFilter: string | null = null;

function fakeDb() {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'neq']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.or = vi.fn((filter: string) => {
    orFilter = filter;
    return chain;
  });
  chain.limit = vi.fn(async () => ({ data: rows, error: null }));
  return { from: vi.fn(() => chain) };
}

const property = { id: 'prop-uuid-1', property_code: 'AV-0021' };

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  orFilter = null;
  vi.mocked(accountPropertyShowcaseUrl).mockResolvedValue(
    'https://aryavarta.convoreal.com/?property_id=AV-0021&v=contact-1'
  );
});

describe('[INB-037] a bot answer carries the listing link once per thread', () => {
  it('appends the attributed showcase link when the thread has none for the listing', async () => {
    const text = await withListingLink({
      db: fakeDb() as never,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      property,
      text: 'This is a Commercial Building listed for sale.',
    });
    expect(text).toBe(
      'This is a Commercial Building listed for sale.\n\nFull details: https://aryavarta.convoreal.com/?property_id=AV-0021&v=contact-1'
    );
    expect(accountPropertyShowcaseUrl).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      property,
      'contact-1'
    );
    expect(orFilter).toBe(
      'content_text.ilike.%property_id=AV-0021%,content_text.ilike.%property_id=prop-uuid-1%'
    );
  });

  it('leaves the answer alone when a team or bot message already linked the listing', async () => {
    rows = [
      {
        content_text:
          'Have a look: https://aryavarta.convoreal.com/?property_id=AV-0021\nCall me after.',
      },
    ];
    const text = await withListingLink({
      db: fakeDb() as never,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      property,
      text: 'The asking price is ₹20 Cr.',
    });
    expect(text).toBe('The asking price is ₹20 Cr.');
    expect(accountPropertyShowcaseUrl).not.toHaveBeenCalled();
  });

  it('does not mistake a longer code for this one', async () => {
    rows = [
      {
        content_text:
          'https://aryavarta.convoreal.com/?property_id=AV-00210&v=contact-1',
      },
    ];
    expect(
      await listingLinkAlreadySent(fakeDb() as never, 'conv-1', property)
    ).toBe(false);
    rows = [
      {
        content_text:
          '🔗 https://aryavarta.convoreal.com/?property_id=AV-0021&v=contact-1',
      },
    ];
    expect(
      await listingLinkAlreadySent(fakeDb() as never, 'conv-1', property)
    ).toBe(true);
  });

  it('treats a lookup failure as no link sent, so the buyer still gets one', async () => {
    const db = {
      from: () => {
        throw new Error('boom');
      },
    };
    expect(await listingLinkAlreadySent(db as never, 'conv-1', property)).toBe(
      false
    );
  });
});
