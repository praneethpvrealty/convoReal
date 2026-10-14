import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: vi.fn(),
}));

import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext } from './context';
import { ownerDigestCommand } from './steps/owner-digest-command';

let ownedListings: { id: string }[] = [];
let listingsError: { message: string } | null = null;
const contactUpdates: unknown[] = [];

function fakeAdmin() {
  return {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'neq']) {
        chain[method] = vi.fn(() => chain);
      }
      chain.limit = vi.fn(async () => ({
        data: listingsError ? null : ownedListings,
        error: listingsError,
      }));
      chain.update = vi.fn((row: unknown) => {
        if (table === 'contacts') contactUpdates.push(row);
        return chain;
      });
      (chain as { then: unknown }).then = (
        resolve: (v: { data: unknown; error: null }) => void
      ) => resolve({ data: ownedListings, error: null });
      return chain;
    }),
  };
}

function ctx(
  text: string,
  consent: string | null = 'pending'
): InboundChainContext {
  return {
    accountId: 'acc-1',
    configOwnerUserId: 'u-1',
    message: {},
    contentText: text,
    contactRecord: {
      id: 'c-1',
      account_id: 'acc-1',
      user_id: null,
      phone: '+919900000001',
      name: 'Surendra',
      owner_digest_consent: consent,
    },
    conversation: { id: 'conv-1' },
  } as unknown as InboundChainContext;
}

beforeEach(() => {
  vi.mocked(sendWhatsAppMessageAndPersist).mockClear();
  vi.mocked(supabaseAdmin).mockImplementation(
    () => fakeAdmin() as unknown as ReturnType<typeof supabaseAdmin>
  );
  contactUpdates.length = 0;
  ownedListings = [{ id: 'p-1' }];
  listingsError = null;
});

describe('[CNV-007] a bare STOP from a digest recipient', () => {
  it('declines the update digest and confirms it, rather than leaving it to the chatbot', async () => {
    expect(await ownerDigestCommand(ctx('STOP'))).toBe('handled');
    expect(contactUpdates).toEqual([
      expect.objectContaining({ owner_digest_consent: 'declined' }),
    ]);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "you won't receive property status updates"
        ),
      })
    );
  });

  it('leaves a bare STOP alone for a contact with no listing to report on', async () => {
    ownedListings = [];
    expect(await ownerDigestCommand(ctx('stop'))).toBe('continue');
    expect(contactUpdates).toEqual([]);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('honours the stop when the listing lookup fails, rather than ignoring it', async () => {
    listingsError = { message: 'statement timeout' };
    expect(await ownerDigestCommand(ctx('STOP'))).toBe('handled');
    expect(contactUpdates).toEqual([
      expect.objectContaining({ owner_digest_consent: 'declined' }),
    ]);
  });

  it('does not answer again for an owner who already declined', async () => {
    expect(await ownerDigestCommand(ctx('Stop', 'declined'))).toBe('continue');
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('never reads STOP inside a sentence as an opt-out', async () => {
    expect(
      await ownerDigestCommand(ctx('stop calling me after 6pm please'))
    ).toBe('continue');
    expect(contactUpdates).toEqual([]);
  });
});
