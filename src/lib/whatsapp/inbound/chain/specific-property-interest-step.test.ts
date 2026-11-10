import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/notifications/create', () => ({
  createNotification: vi.fn(),
}));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: vi.fn(),
}));
vi.mock('@/lib/whatsapp/inbound/property-share-replies', () => ({
  handlePropertyShareYesReply: vi.fn(),
}));
vi.mock('@/lib/journey/lead-interest', () => ({
  recordJourneyLeadInterest: vi.fn(),
}));
vi.mock('@/lib/inventory/unavailable-reply', () => ({
  unavailableListingReplyWithShowcase: vi.fn(),
}));
vi.mock('@/lib/whatsapp/unavailable-brief-followup', () => ({
  sendRequirementConfirmAfterRegret: vi.fn(),
}));

import { createNotification } from '@/lib/notifications/create';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildUnresolvedPropertyInterestAck } from '@/lib/whatsapp/property-interest';
import type { OwnedListing } from '@/lib/owners/owner-reply';
import type { InboundChainContext } from './context';
import { specificPropertyInterest } from './steps/specific-property-interest';

const OWNED: OwnedListing = {
  id: 'prop-owned',
  title: '2 Acres 4 Guntas Land for Joint Development',
  property_code: 'PROP-2079',
  type: 'Residential Land',
  status: 'Available',
  location: 'Tavarekere',
  sublocality: 'Tavarekere',
  city: 'Bengaluru',
  is_published: true,
};

function fakeAdmin() {
  const query: Record<string, unknown> = {};
  for (const method of ['update', 'eq']) {
    query[method] = vi.fn(() => query);
  }
  query.then = (resolve: (value: { error: null }) => void) =>
    resolve({ error: null });
  return { from: vi.fn(() => query) };
}

function context(overrides: Partial<InboundChainContext>): InboundChainContext {
  return {
    accountId: 'acc-1',
    message: { id: 'wamid-1', type: 'text' },
    configOwnerUserId: 'owner-user',
    senderPhone: '919900000002',
    contentText:
      "Can I know your details please of  the same what's app number",
    enquiryPropertyId: null,
    enquiryIsDeliberate: false,
    enquiryPropertyTitle: null,
    enquiryPropertyStatus: null,
    specificPropertyInterest: true,
    propertyReferenceNeedsAgent: true,
    ownerCheck: { isOwner: false },
    contactRecord: { id: 'contact-1', name: 'Chamraju' },
    conversation: { id: 'conv-1' },
    assignedAgentUserId: 'agent-user',
    ownedListings: [],
    isPropertyOwnerSender: false,
    ...overrides,
  } as unknown as InboundChainContext;
}

describe('[CNV-014] the buyer property-interest step and property owners', () => {
  beforeEach(() => {
    vi.mocked(createNotification).mockReset();
    vi.mocked(sendWhatsAppMessageAndPersist).mockClear();
    vi.mocked(supabaseAdmin).mockReturnValue(
      fakeAdmin() as unknown as ReturnType<typeof supabaseAdmin>
    );
  });

  it('leaves an owner writing about their own listings to the owner reply', async () => {
    const result = await specificPropertyInterest(
      context({ ownedListings: [OWNED], isPropertyOwnerSender: true })
    );
    expect(result).toBe('continue');
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('leaves an owner naming their own listing to the owner reply', async () => {
    const result = await specificPropertyInterest(
      context({
        ownedListings: [OWNED],
        isPropertyOwnerSender: true,
        enquiryPropertyId: OWNED.id,
        enquiryPropertyTitle: OWNED.title,
        propertyReferenceNeedsAgent: false,
      })
    );
    expect(result).toBe('continue');
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('still hands a buyer whose reference cannot be matched to an agent', async () => {
    const result = await specificPropertyInterest(context({}));
    expect(result).toBe('handled');
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: buildUnresolvedPropertyInterestAck('Chamraju'),
      })
    );
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});
