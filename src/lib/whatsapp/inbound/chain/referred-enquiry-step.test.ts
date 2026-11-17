import { beforeEach, describe, expect, it, vi } from 'vitest';

const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {
        update: (values: Record<string, unknown>) => {
          updates.push({ table, values });
          return b;
        },
        eq: () => b,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return b;
    },
  }),
}));
const send = vi.fn<
  (args: Record<string, unknown>) => Promise<{ success: boolean }>
>(async () => ({ success: true }));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (args: Record<string, unknown>) => send(args),
}));
const lib = {
  hasPendingReferredEnquiry: vi.fn(),
  hideWhatsAppGuest: vi.fn(),
  openReferredEnquiry: vi.fn(),
  quietGuestThread: vi.fn(),
  resolveWhatsAppTapReferrer: vi.fn(),
};
vi.mock('@/lib/showcase/referred-enquiries', () => ({
  buildGuestHoldAck: (name: string, subject: string) =>
    `ack ${name} ${subject}`,
  hasPendingReferredEnquiry: (...a: unknown[]) =>
    lib.hasPendingReferredEnquiry(...a),
  hideWhatsAppGuest: (...a: unknown[]) => lib.hideWhatsAppGuest(...a),
  openReferredEnquiry: (...a: unknown[]) => lib.openReferredEnquiry(...a),
  quietGuestThread: (...a: unknown[]) => lib.quietGuestThread(...a),
  resolveWhatsAppTapReferrer: (...a: unknown[]) =>
    lib.resolveWhatsAppTapReferrer(...a),
}));

const { referredEnquiry } = await import('./steps/referred-enquiry');
const { INBOUND_STEPS, STEPS_WHILE_BOT_PAUSED } = await import('./steps');

const NIMMY = {
  contactId: 'contact-nimmy',
  name: 'Nimmy',
  phone: '+918657601861',
  sessionKey: 'session-1',
};

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    accountId: 'acc-1',
    message: { type: 'text', id: 'wamid.1' },
    senderPhone: '919845959646',
    contentText:
      'Hi! I am interested in your property "Commercial Building" (Property ID: PROP-2551)',
    enquiryPropertyId: 'prop-1',
    enquiryIsDeliberate: true,
    enquiryPropertyTitle: 'Commercial Building',
    ownerCheck: { isOwner: false },
    contactRecord: { id: 'guest-1', name: 'Garments And Fitness Center' },
    conversation: { id: 'conv-1' },
    contactWasCreated: true,
    assignedAgentUserId: 'user-owner',
    ...overrides,
  } as never;
}

beforeEach(() => {
  updates.length = 0;
  send.mockClear();
  Object.values(lib).forEach((fn) => fn.mockReset());
});

describe('[PLS-010] a WhatsApp enquiry from an agent’s guest is held', () => {
  it('runs straight after the control replies and while the bot is paused', () => {
    const names = INBOUND_STEPS.map((step) => step.name);
    expect(names.indexOf('referredEnquiry')).toBe(
      names.indexOf('controlReply') + 1
    );
    expect(names.indexOf('referredEnquiry')).toBeLessThan(
      names.indexOf('deliberateEnquiry')
    );
    expect(STEPS_WHILE_BOT_PAUSED.has('referredEnquiry')).toBe(true);
  });

  it('holds a new sender whose enquiry follows a forwarded-link guest’s tap, and hides them', async () => {
    lib.resolveWhatsAppTapReferrer.mockResolvedValue({
      ...NIMMY,
      isAgent: true,
    });
    lib.openReferredEnquiry.mockResolvedValue('pending');

    expect(await referredEnquiry(ctx())).toBe('handled');
    expect(lib.openReferredEnquiry.mock.calls[0][1]).toMatchObject({
      source: 'whatsapp',
      contactId: 'guest-1',
      conversationId: 'conv-1',
      sessionKey: 'session-1',
      payload: { targetAgentUserId: 'user-owner' },
    });
    expect(send.mock.calls[0][0]).toMatchObject({
      contactId: 'guest-1',
      allowChainOnly: true,
    });
    expect(lib.hideWhatsAppGuest).toHaveBeenCalledWith(expect.anything(), {
      accountId: 'acc-1',
      contactId: 'guest-1',
      conversationId: 'conv-1',
    });
  });

  it('lets the enquiry through with the referrer credited when the agent cannot be asked or the sharer is not an agent', async () => {
    lib.resolveWhatsAppTapReferrer.mockResolvedValue({
      ...NIMMY,
      isAgent: true,
    });
    lib.openReferredEnquiry.mockResolvedValue('undeliverable');
    expect(await referredEnquiry(ctx())).toBe('continue');

    lib.resolveWhatsAppTapReferrer.mockResolvedValue({
      ...NIMMY,
      isAgent: false,
    });
    expect(await referredEnquiry(ctx())).toBe('continue');
    expect(lib.openReferredEnquiry).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      expect.objectContaining({
        table: 'contacts',
        values: expect.objectContaining({
          referrer_contact_id: 'contact-nimmy',
        }),
      }),
      expect.objectContaining({
        table: 'contacts',
        values: expect.objectContaining({
          referrer_contact_id: 'contact-nimmy',
        }),
      }),
    ]);
    expect(lib.hideWhatsAppGuest).not.toHaveBeenCalled();
  });

  it('never holds an existing contact, the owner, or a message that names no listing', async () => {
    expect(await referredEnquiry(ctx({ contactWasCreated: false }))).toBe(
      'continue'
    );
    expect(await referredEnquiry(ctx({ ownerCheck: { isOwner: true } }))).toBe(
      'continue'
    );
    expect(await referredEnquiry(ctx({ enquiryIsDeliberate: false }))).toBe(
      'continue'
    );
    lib.resolveWhatsAppTapReferrer.mockResolvedValue(null);
    expect(await referredEnquiry(ctx())).toBe('continue');
    expect(lib.openReferredEnquiry).not.toHaveBeenCalled();
  });

  it('keeps a held guest’s later messages away from the bot and the agent', async () => {
    lib.hasPendingReferredEnquiry.mockResolvedValue(true);
    const held = ctx({
      contactWasCreated: false,
      contactRecord: { id: 'guest-1', name: 'Guest', chain_only: true },
    });
    expect(await referredEnquiry(held)).toBe('handled');
    expect(lib.quietGuestThread).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    lib.hasPendingReferredEnquiry.mockResolvedValue(false);
    expect(await referredEnquiry(held)).toBe('continue');
  });
});
