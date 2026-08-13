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
  sendPropertyEnquiryCard,
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

  it('sends three buttons, each carrying both ids', async () => {
    vi.clearAllMocks();
    resolveOwnerWhatsAppContact.mockResolvedValue({
      contactId: 'agent-contact',
      phone: '+919900277111',
    });
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });

    expect(await sendPropertyEnquiryCard(args({ title: 'A plot' }))).toBe(true);

    const call = sendWhatsAppMessageAndPersist.mock.calls[0][0];
    expect(call.contactId).toBe('agent-contact');
    expect(call.interactiveButtons).toHaveLength(3);
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
});
