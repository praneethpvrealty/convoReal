import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureJourneyItems = vi.fn(async () => ({ created: 1, error: null }));
const select = vi.fn(async () => ({ data: [{ id: 'share-1' }], error: null }));
const upsert = vi.fn(() => ({ select }));
const from = vi.fn(() => ({ upsert }));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from }),
}));
vi.mock('@/lib/journey/capture', () => ({ captureJourneyItems }));

const { recordPropertyShares } = await import('./share-log');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordPropertyShares journey visibility', () => {
  it('keeps broadcast shares in the Captured tray by default', async () => {
    await recordPropertyShares({
      accountId: 'account-1',
      propertyId: 'property-1',
      userId: 'user-1',
      recipients: [{ contactId: 'contact-1', classification: 'Buyer' }],
    });

    expect(captureJourneyItems).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: true }),
    );
  });

  it('shows a deliberate one-to-one share on the journey map', async () => {
    await recordPropertyShares({
      accountId: 'account-1',
      propertyId: 'property-1',
      userId: 'user-1',
      recipients: [{ contactId: 'contact-1', classification: 'Buyer' }],
      journeyVisible: true,
    });

    expect(captureJourneyItems).toHaveBeenCalledWith(
      expect.objectContaining({
        hidden: false,
        pairs: [{ contactId: 'contact-1', propertyId: 'property-1' }],
      }),
    );
  });
});
