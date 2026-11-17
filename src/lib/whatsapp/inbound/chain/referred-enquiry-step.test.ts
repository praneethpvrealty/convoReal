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
  hideWhatsAppGuest: vi.fn(),
  lastGuestEnquiry: vi.fn(),
  openReferredEnquiry: vi.fn(),
  resolveWhatsAppTapReferrer: vi.fn(),
  revealWhatsAppGuest: vi.fn(),
};
vi.mock('@/lib/showcase/referred-enquiries', () => ({
  buildGuestHoldAck: (name: string, subject: string) =>
    `ack ${name} ${subject}`,
  hideWhatsAppGuest: (...a: unknown[]) => lib.hideWhatsAppGuest(...a),
  lastGuestEnquiry: (...a: unknown[]) => lib.lastGuestEnquiry(...a),
  openReferredEnquiry: (...a: unknown[]) => lib.openReferredEnquiry(...a),
  resolveWhatsAppTapReferrer: (...a: unknown[]) =>
    lib.resolveWhatsAppTapReferrer(...a),
  revealWhatsAppGuest: (...a: unknown[]) => lib.revealWhatsAppGuest(...a),
}));

const { referredEnquiry } = await import('./steps/referred-enquiry');
const { INBOUND_STEPS, STEPS_WHILE_BOT_PAUSED } = await import('./steps');

const NIMMY = {
  contactId: 'contact-nimmy',
  name: 'Nimmy',
  phone: '+918657601861',
  isAgent: true,
};
const THREAD = {
  accountId: 'acc-1',
  contactId: 'guest-1',
  conversationId: 'conv-1',
};
const ENQUIRY =
  'Hi! I am interested in your property "Commercial Building" (Property ID: PROP-2551) (Ref 9c7c5a9b)';

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    accountId: 'acc-1',
    message: { type: 'text', id: 'wamid.1' },
    senderPhone: '919845959646',
    contentText: ENQUIRY,
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

function hiddenGuest(overrides: Record<string, unknown> = {}) {
  return ctx({
    contactWasCreated: false,
    contactRecord: { id: 'guest-1', name: 'Guest', chain_only: true },
    ...overrides,
  });
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

  it('holds a new sender whose message names a forwarded-link guest’s session, and hides them', async () => {
    lib.resolveWhatsAppTapReferrer.mockResolvedValue({
      ...NIMMY,
      sessionKey: 'session-1',
    });
    lib.openReferredEnquiry.mockResolvedValue('pending');

    expect(await referredEnquiry(ctx())).toBe('handled');
    expect(lib.resolveWhatsAppTapReferrer.mock.calls[0][1]).toMatchObject({
      propertyId: 'prop-1',
      enquiryRef: '9c7c5a9b',
    });
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
    expect(lib.hideWhatsAppGuest).toHaveBeenCalledWith(
      expect.anything(),
      THREAD
    );
  });

  it('passes no reference for a direct buyer’s message, so it is never held', async () => {
    lib.resolveWhatsAppTapReferrer.mockResolvedValue(null);
    expect(
      await referredEnquiry(
        ctx({ contentText: 'Hi! (Property ID: PROP-2551)' })
      )
    ).toBe('continue');
    expect(lib.resolveWhatsAppTapReferrer.mock.calls[0][1].enquiryRef).toBe(
      null
    );
    expect(lib.openReferredEnquiry).not.toHaveBeenCalled();
  });

  it('lets the enquiry through with the referrer credited when the agent cannot be asked or the sharer is not an agent', async () => {
    lib.resolveWhatsAppTapReferrer.mockResolvedValue({
      ...NIMMY,
      sessionKey: 'session-1',
    });
    lib.openReferredEnquiry.mockResolvedValue('undeliverable');
    expect(await referredEnquiry(ctx())).toBe('continue');
    expect(lib.revealWhatsAppGuest).toHaveBeenCalledWith(expect.anything(), {
      ...THREAD,
      referrerContactId: 'contact-nimmy',
    });

    lib.resolveWhatsAppTapReferrer.mockResolvedValue({
      ...NIMMY,
      isAgent: false,
      sessionKey: 'session-1',
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
    ]);
    expect(lib.hideWhatsAppGuest).not.toHaveBeenCalled();
  });

  it('never holds an ordinary contact, the owner, or a message that names no listing', async () => {
    expect(await referredEnquiry(ctx({ contactWasCreated: false }))).toBe(
      'continue'
    );
    expect(await referredEnquiry(ctx({ ownerCheck: { isOwner: true } }))).toBe(
      'continue'
    );
    expect(await referredEnquiry(ctx({ enquiryIsDeliberate: false }))).toBe(
      'continue'
    );
    expect(lib.resolveWhatsAppTapReferrer).not.toHaveBeenCalled();
    lib.lastGuestEnquiry.mockResolvedValue(null);
    lib.resolveWhatsAppTapReferrer.mockResolvedValue(null);
    expect(await referredEnquiry(hiddenGuest())).toBe('continue');
    expect(lib.openReferredEnquiry).not.toHaveBeenCalled();
  });

  it('hides a new sender whose number has a form enquiry waiting or declined, with or without a reference', async () => {
    lib.lastGuestEnquiry.mockResolvedValue({
      status: 'pending',
      sessionKey: 'session-1',
      referrer: NIMMY,
    });
    expect(
      await referredEnquiry(
        ctx({
          contentText: 'Hello, is this still available?',
          enquiryPropertyId: null,
          enquiryIsDeliberate: false,
        })
      )
    ).toBe('handled');
    expect(lib.lastGuestEnquiry.mock.calls[0][1]).toMatchObject({
      contactId: 'guest-1',
      senderPhone: '919845959646',
    });
    expect(lib.hideWhatsAppGuest).toHaveBeenCalledWith(
      expect.anything(),
      THREAD
    );
    expect(send).not.toHaveBeenCalled();

    lib.lastGuestEnquiry.mockResolvedValue({
      status: 'expired',
      sessionKey: 'session-1',
      referrer: NIMMY,
    });
    lib.openReferredEnquiry.mockResolvedValue('closed');
    expect(
      await referredEnquiry(
        ctx({ contentText: 'Hi! (Property ID: PROP-2551)' })
      )
    ).toBe('handled');
    expect(lib.openReferredEnquiry.mock.calls[0][1]).toMatchObject({
      referrer: NIMMY,
      contactId: 'guest-1',
    });
    expect(lib.resolveWhatsAppTapReferrer).not.toHaveBeenCalled();
  });

  it('holds a hidden contact with no enquiry on record when their message names a guest session', async () => {
    lib.lastGuestEnquiry.mockResolvedValue(null);
    lib.resolveWhatsAppTapReferrer.mockResolvedValue({
      ...NIMMY,
      sessionKey: 'session-1',
    });
    lib.openReferredEnquiry.mockResolvedValue('closed');
    expect(await referredEnquiry(hiddenGuest())).toBe('handled');
    expect(lib.openReferredEnquiry.mock.calls[0][1]).toMatchObject({
      referrer: expect.objectContaining({ contactId: 'contact-nimmy' }),
      sessionKey: 'session-1',
    });
  });

  it('keeps a waiting guest’s later messages away from the bot and the agent, and records an enquiry on another listing', async () => {
    lib.lastGuestEnquiry.mockResolvedValue({
      status: 'pending',
      sessionKey: 'session-1',
      referrer: NIMMY,
    });
    expect(
      await referredEnquiry(
        hiddenGuest({
          contentText: 'hello?',
          enquiryPropertyId: null,
          enquiryIsDeliberate: false,
        })
      )
    ).toBe('handled');
    expect(lib.hideWhatsAppGuest).toHaveBeenCalledWith(
      expect.anything(),
      THREAD
    );
    expect(send).not.toHaveBeenCalled();
    expect(lib.openReferredEnquiry).not.toHaveBeenCalled();

    lib.openReferredEnquiry.mockResolvedValue('pending');
    expect(
      await referredEnquiry(hiddenGuest({ enquiryPropertyId: 'prop-2' }))
    ).toBe('handled');
    expect(lib.openReferredEnquiry.mock.calls[0][1]).toMatchObject({
      propertyId: 'prop-2',
      referrer: NIMMY,
      contactId: 'guest-1',
    });
  });

  it('keeps a declined guest hidden: a later chat message is swallowed and a new enquiry goes back to the agent', async () => {
    lib.lastGuestEnquiry.mockResolvedValue({
      status: 'rejected',
      sessionKey: 'session-1',
      referrer: NIMMY,
    });
    expect(
      await referredEnquiry(
        hiddenGuest({
          contentText: 'any update?',
          enquiryPropertyId: null,
          enquiryIsDeliberate: false,
        })
      )
    ).toBe('handled');
    expect(lib.openReferredEnquiry).not.toHaveBeenCalled();

    lib.openReferredEnquiry.mockResolvedValue('closed');
    expect(await referredEnquiry(hiddenGuest())).toBe('handled');
    expect(lib.openReferredEnquiry.mock.calls[0][1]).toMatchObject({
      referrer: NIMMY,
      contactId: 'guest-1',
      sessionKey: 'session-1',
    });
    expect(send).not.toHaveBeenCalled();
    expect(lib.hideWhatsAppGuest).toHaveBeenCalledWith(
      expect.anything(),
      THREAD
    );
    expect(lib.resolveWhatsAppTapReferrer).not.toHaveBeenCalled();
  });
});
