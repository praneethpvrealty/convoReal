import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A showcase enquiry used to arrive as a line of text with a generic
// "someone messaged you" ping, while a listing-access request in the
// same inbox arrived as a card with buttons. These pin the card that
// closes that gap — and, most of all, that both ids survive the round
// trip through the button, since the card lands in the agent's thread
// and every action operates on the buyer's.

const sendWhatsAppMessageAndPersist = vi.fn();
const resolveOwnerWhatsAppContact = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/inventory/location-requests', () => ({
  resolveOwnerWhatsAppContact: (...args: unknown[]) =>
    resolveOwnerWhatsAppContact(...args),
}));

const {
  parseEnquiryReply,
  buildEnquiryCardBody,
  buildEnquiryAckText,
  buildEnquiryRejectText,
  resolveEnquiryTeamPhone,
  sendPropertyEnquiryCard,
  ENQUIRY_APPROVE_PREFIX,
  ENQUIRY_PHOTOS_PREFIX,
} = await import('./enquiry-card');

const PROPERTY_ID = 'cf9cc635-6bb6-45d3-8ea8-9c4ebac79af7';
const CONTACT_ID = '2a677edc-ccca-4e41-b21c-ed64662508e6';

describe('parseEnquiryReply', () => {
  it('round-trips both ids out of a button', () => {
    expect(
      parseEnquiryReply(`${ENQUIRY_PHOTOS_PREFIX}${PROPERTY_ID}:${CONTACT_ID}`)
    ).toEqual({
      action: 'photos',
      propertyId: PROPERTY_ID,
      contactId: CONTACT_ID,
    });
  });

  it('reads each action', () => {
    expect(
      parseEnquiryReply(`enq_approve:${PROPERTY_ID}:${CONTACT_ID}`)?.action
    ).toBe('approve');
    expect(
      parseEnquiryReply(`enq_reject:${PROPERTY_ID}:${CONTACT_ID}`)?.action
    ).toBe('reject');
  });

  it('still reads the first card generation, which may sit untapped in a thread', () => {
    expect(
      parseEnquiryReply(`enq_photos:${PROPERTY_ID}:${CONTACT_ID}`)?.action
    ).toBe('photos');
    expect(
      parseEnquiryReply(`enq_details:${PROPERTY_ID}:${CONTACT_ID}`)?.action
    ).toBe('details');
    expect(
      parseEnquiryReply(`enq_mine:${PROPERTY_ID}:${CONTACT_ID}`)?.action
    ).toBe('mine');
  });

  it('ignores every other button in the inbox', () => {
    // These share the thread with the card and must not be claimed.
    for (const id of [
      'share_property_yes:abc',
      'browse_all_properties',
      'locreq_owner_approve:xyz',
      '',
      null,
      undefined,
    ]) {
      expect(parseEnquiryReply(id), String(id)).toBeNull();
    }
  });

  it('refuses a half-formed id rather than guessing a contact', () => {
    // Acting on the wrong buyer's thread is worse than not acting.
    expect(
      parseEnquiryReply(`${ENQUIRY_PHOTOS_PREFIX}${PROPERTY_ID}`)
    ).toBeNull();
    expect(parseEnquiryReply(`${ENQUIRY_PHOTOS_PREFIX}:`)).toBeNull();
  });
});

describe('buildEnquiryCardBody', () => {
  const property = {
    title: '50x70 Commercial Land in 6th Block, Koramangala',
    property_code: 'PROP-1030',
    price: 150000000,
    sublocality: '6th Block, Koramangala',
    city: 'Bengaluru',
  };

  it('leads with the listing the agent has to recognise', () => {
    const body = buildEnquiryCardBody(
      property,
      'Ganesh',
      '+919972026477',
      'Hi! I am interested in your property'
    );

    expect(body).toContain('New Property Enquiry');
    expect(body).toContain('50x70 Commercial Land in 6th Block, Koramangala');
    expect(body).toContain('PROP-1030');
    expect(body).toContain('₹15 Cr');
    expect(body).toContain('Ganesh · +919972026477');
  });

  it('survives a listing with no price or locality', () => {
    const body = buildEnquiryCardBody(
      { title: 'A plot' },
      'Ganesh',
      '+91997',
      'interested'
    );
    expect(body).toContain('A plot');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('NaN');
  });

  it('truncates a long enquiry rather than blowing the body limit', () => {
    const body = buildEnquiryCardBody(
      property,
      'Ganesh',
      '+91997',
      'x'.repeat(500)
    );
    expect(body.length).toBeLessThan(1024);
  });
});

describe('buildEnquiryAckText', () => {
  it('promises the details rather than interrogating', () => {
    // What the buyer used to get here was "what budget range are you
    // working with?" — asked of someone who had named the listing.
    const text = buildEnquiryAckText('Ganesh K P', '50x70 Commercial Land');
    expect(text).toContain('Thanks Ganesh!');
    expect(text).toContain('*50x70 Commercial Land*');
    expect(text).toMatch(/details.*shortly/i);
    expect(text).not.toMatch(/budget/i);
  });

  it('survives a nameless contact and an unloaded title', () => {
    const text = buildEnquiryAckText(null, null);
    expect(text).toContain('Thanks!');
    expect(text).toContain('that property');
  });
});

describe('buildEnquiryRejectText', () => {
  it('points the buyer at the team, closing the promise the ack made', () => {
    // The ack said "you'll receive the complete details right here
    // shortly" — a rejected buyer used to hear nothing at all after
    // that. This is the message that closes the loop instead.
    const text = buildEnquiryRejectText(
      'Ganesh K P',
      '50x70 Commercial Land',
      '+919900277111'
    );
    expect(text).toContain('Hi Ganesh!');
    expect(text).toContain('*50x70 Commercial Land*');
    expect(text).toContain('speak with our team directly on +919900277111');
    // "Rejected" is the agent's word, never the buyer's.
    expect(text).not.toMatch(/reject/i);
  });

  it('still closes the loop when no team number is resolvable', () => {
    const text = buildEnquiryRejectText(null, null, null);
    expect(text).toContain('Hi!');
    expect(text).toContain('that property');
    expect(text).toContain('reach out to you directly');
    expect(text).not.toContain('null');
  });
});

describe('resolveEnquiryTeamPhone', () => {
  function settingsDb(contactPhone: string | null) {
    return {
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) chain[m] = () => chain;
        chain.maybeSingle = async () => ({
          data: contactPhone === null ? null : { contact_phone: contactPhone },
        });
        return chain;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it('prefers the number the brokerage publishes on its showcase', async () => {
    resolveOwnerWhatsAppContact.mockResolvedValue({
      contactId: 'agent-contact',
      phone: '+911111111111',
    });
    expect(
      await resolveEnquiryTeamPhone(settingsDb('+919900277111'), 'a', 'u')
    ).toBe('+919900277111');
  });

  it('falls back to the routed agent when none is set', async () => {
    resolveOwnerWhatsAppContact.mockResolvedValue({
      contactId: 'agent-contact',
      phone: '+919900277111',
    });
    expect(await resolveEnquiryTeamPhone(settingsDb('  '), 'a', 'u')).toBe(
      '+919900277111'
    );
    expect(await resolveEnquiryTeamPhone(settingsDb(null), 'a', 'u')).toBe(
      '+919900277111'
    );
  });

  it('reports null rather than inventing a number', async () => {
    resolveOwnerWhatsAppContact.mockResolvedValue(null);
    expect(await resolveEnquiryTeamPhone(settingsDb(null), 'a', 'u')).toBeNull();
  });
});

describe('sendPropertyEnquiryCard', () => {
  function db(property: unknown) {
    return {
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: property });
        return chain;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  const args = (property: unknown) => ({
    db: db(property),
    accountId: 'acct-1',
    agentUserId: 'user-1',
    propertyId: PROPERTY_ID,
    contactId: CONTACT_ID,
    leadName: 'Ganesh',
    leadPhone: '+919972026477',
    enquiryText: 'Hi! I am interested',
  });

  it('sends Approve and Reject, each carrying both ids', async () => {
    vi.clearAllMocks();
    resolveOwnerWhatsAppContact.mockResolvedValue({
      contactId: 'agent-contact',
      phone: '+919900277111',
    });
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });

    expect(await sendPropertyEnquiryCard(args({ title: 'A plot' }))).toBe(true);

    const call = sendWhatsAppMessageAndPersist.mock.calls[0][0];
    expect(call.contactId).toBe('agent-contact');
    expect(call.interactiveButtons).toHaveLength(2);
    expect(call.interactiveButtons[0].id).toBe(
      `${ENQUIRY_APPROVE_PREFIX}${PROPERTY_ID}:${CONTACT_ID}`
    );
    expect(call.interactiveButtons[0].title).toContain('Approve');
    expect(call.interactiveButtons[1].title).toContain('Reject');
    for (const button of call.interactiveButtons) {
      expect(button.id).toContain(PROPERTY_ID);
      expect(button.id).toContain(CONTACT_ID);
      // WhatsApp rejects a button id over 256 chars outright.
      expect(button.id.length).toBeLessThanOrEqual(256);
      expect(button.title.length).toBeLessThanOrEqual(20);
    }
  });

  it('falls back to the agent phone when they have no contact row', async () => {
    vi.clearAllMocks();
    resolveOwnerWhatsAppContact.mockResolvedValue({
      contactId: null,
      phone: '+919900277111',
    });
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });

    await sendPropertyEnquiryCard(args({ title: 'A plot' }));

    const call = sendWhatsAppMessageAndPersist.mock.calls[0][0];
    expect(call.toPhone).toBe('+919900277111');
    expect(call.contactId).toBeUndefined();
  });

  it('reports false when the listing is gone, so the plain ping still goes', async () => {
    vi.clearAllMocks();
    resolveOwnerWhatsAppContact.mockResolvedValue({
      contactId: 'agent-contact',
      phone: '+919900277111',
    });

    expect(await sendPropertyEnquiryCard(args(null))).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('reports false when the agent has no reachable number', async () => {
    vi.clearAllMocks();
    resolveOwnerWhatsAppContact.mockResolvedValue(null);

    expect(await sendPropertyEnquiryCard(args({ title: 'A plot' }))).toBe(
      false
    );
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('reports false when the send fails', async () => {
    vi.clearAllMocks();
    resolveOwnerWhatsAppContact.mockResolvedValue({
      contactId: 'agent-contact',
      phone: '+919900277111',
    });
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: false });

    expect(await sendPropertyEnquiryCard(args({ title: 'A plot' }))).toBe(
      false
    );
  });
});

// The card is only reached if the webhook actually calls it, and the
// enquiry taps only work if they are dispatched before the owner
// chatbot claims the agent's own message.
describe('the webhook wires the card up', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/whatsapp/webhook-handler.ts'),
    'utf8'
  );

  it('sends the card on a first inbound that names a listing', () => {
    expect(source).toContain('sendPropertyEnquiryCard({');
    expect(source).toContain('enquiryPropertyId');
  });

  it('suppresses the generic ping when the card went instead', () => {
    // Two WhatsApp messages saying the same thing is the noise this
    // replaces, not adds to.
    expect(source).toContain('cardSent');
    expect(source).toContain('pingedOnWhatsApp = cardSent ||');
  });

  it('dispatches an enquiry tap before the owner chatbot sees it', () => {
    const tap = source.indexOf('const enquiryAction = parseEnquiryReply(');
    const ownerChatbot = source.indexOf('processOwnerChatbotMessage(');
    expect(tap).toBeGreaterThan(-1);
    expect(ownerChatbot).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(ownerChatbot);
  });

  it('consumes an explicit enquiry before the ladder can interrogate it', () => {
    // The first live tap of the Enquire button was answered with "what
    // budget range are you working with?" — the qualification ladder
    // claiming a buyer who had just named the exact listing — because
    // the enquiry branch was gated on the contact's first-ever message
    // and this buyer had messaged before.
    const enquiryBranch = source.indexOf('enquiryByCode &&');
    const ladder = source.indexOf('processBuyerQualificationMessage(');
    expect(enquiryBranch).toBeGreaterThan(-1);
    expect(ladder).toBeGreaterThan(-1);
    expect(enquiryBranch).toBeLessThan(ladder);
    // And it acknowledges the buyer rather than going quiet on them.
    expect(source).toContain(
      'buildEnquiryAckText(contactRecord.name, enquiryPropertyTitle)'
    );
  });

  it('confirms each tap back to the agent, like the location card does', () => {
    expect(source).toContain('✅ Approved — complete details for');
    expect(source).toContain('was asked to reach your team directly');
    // The legacy "I'll answer" button alone stays fully silent.
    expect(source).toContain('❌ Rejected — nothing was sent to');
  });

  it('tells a rejected buyer where the team is, instead of going quiet', () => {
    // Live test: the buyer tapped Enquire, got the ack's promise of
    // details "shortly", the agent tapped Reject — and the buyer heard
    // nothing, ever. The reject branch must message the buyer's thread,
    // not just flag the agent's.
    expect(source).toContain(
      'buildEnquiryRejectText(lead.name, propertyRow?.title, teamPhone)'
    );
    expect(source).toContain('resolveEnquiryTeamPhone(');
  });
});
