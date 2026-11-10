import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/lib/ai/gemini', () => ({ generateText: vi.fn() }));
vi.mock('@/lib/whatsapp/template-language', () => ({
  accountDefaultLanguage: vi.fn(async () => 'en'),
  resolveLanguage: vi.fn(() => 'en'),
}));
vi.mock('@/lib/owners/owner-digest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/owners/owner-digest')>()),
  gatherOwnerDigests: vi.fn(async () => []),
}));
vi.mock('@/lib/voice/assigned-agent', () => ({
  resolveAssignedAgent: vi.fn(async () => ({
    name: 'Praneeth',
    phone: '919900000001',
  })),
}));
vi.mock('./owner-callback', () => ({ fileOwnerCallback: vi.fn() }));

import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { generateText } from '@/lib/ai/gemini';
import { resolveAssignedAgent } from '@/lib/voice/assigned-agent';
import { fileOwnerCallback } from './owner-callback';
import { handleOwnerInboundMessage, type OwnedListing } from './owner-reply';

const LISTING: OwnedListing = {
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
  for (const method of ['select', 'eq']) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(async () => ({
    data: { name: 'Aryavarta Ventures' },
    error: null,
  }));
  return { from: vi.fn(() => query) };
}

const args = {
  accountId: 'acc-1',
  userId: 'owner-user',
  contactId: 'contact-1',
  contactName: 'Chamraju',
  conversationId: 'conv-1',
  digestConsent: 'granted',
  listings: [LISTING],
  agentUserId: 'agent-user',
  contactPhone: '919900000002',
};

function sentText(): string {
  return vi.mocked(sendWhatsAppMessageAndPersist).mock.calls[0][0]
    .text as string;
}

describe('[CNV-014] handleOwnerInboundMessage', () => {
  beforeEach(() => {
    vi.mocked(sendWhatsAppMessageAndPersist).mockClear();
    vi.mocked(generateText).mockReset();
    vi.mocked(fileOwnerCallback).mockReset();
    vi.mocked(resolveAssignedAgent).mockClear();
    vi.mocked(supabaseAdmin).mockReturnValue(
      fakeAdmin() as unknown as ReturnType<typeof supabaseAdmin>
    );
  });

  it('tells an owner who asks for our details who we are, without the model', async () => {
    const handled = await handleOwnerInboundMessage({
      ...args,
      text: "Can I know your details please of  the same what's app number",
    });
    expect(handled).toBe(true);
    expect(generateText).not.toHaveBeenCalled();
    expect(fileOwnerCallback).not.toHaveBeenCalled();
    expect(resolveAssignedAgent).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      'agent-user'
    );
    expect(sentText()).toContain('*Aryavarta Ventures*');
    expect(sentText()).toContain('*Praneeth* — +919900000001');
  });

  it('files the call-back before the reply confirms it', async () => {
    vi.mocked(fileOwnerCallback).mockResolvedValue({
      filed: true,
      when: 'after 10:00 am today',
    });
    vi.mocked(generateText).mockResolvedValue(
      'Praneeth will call you after 10:00 am today.'
    );
    await handleOwnerInboundMessage({
      ...args,
      text: 'Hi we will discuss regarding the above property 2 Acre 4 guntas & 3 acre IVC road...call me after 10.00 a.m today',
    });
    expect(fileOwnerCallback).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentUserId: 'agent-user',
        contactId: 'contact-1',
        contactPhone: '919900000002',
        listingTitles: [LISTING.title],
      })
    );
    expect(vi.mocked(generateText).mock.calls[0][0]).toContain(
      'Call-back: logged for Praneeth, requested time after 10:00 am today (IST).'
    );
    expect(
      vi.mocked(fileOwnerCallback).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(sendWhatsAppMessageAndPersist).mock.invocationCallOrder[0]
    );
  });

  it('states the call-back itself when the model is unavailable', async () => {
    vi.mocked(fileOwnerCallback).mockResolvedValue({ filed: true, when: null });
    vi.mocked(generateText).mockRejectedValue(new Error('down'));
    await handleOwnerInboundMessage({ ...args, text: 'Please call me' });
    expect(sentText()).toContain("I've asked Praneeth to call you shortly.");
  });

  it('files nothing for an ordinary question', async () => {
    vi.mocked(generateText).mockResolvedValue('This is about your listing.');
    await handleOwnerInboundMessage({
      ...args,
      text: 'Which land are you talking about',
    });
    expect(fileOwnerCallback).not.toHaveBeenCalled();
  });
});
