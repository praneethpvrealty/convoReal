import { describe, it, expect, vi } from 'vitest';

// The simulator's whole job is to show an agent what the bot would
// actually say. It had no test, and it drifted: the three routes the
// qualification ladder now stands down for were still previewed as the
// ladder's own question — including the "what kind of property are you
// looking for?" that the photo carve-out exists to prevent.
//
// These drive the real route handler and assert on the exact text a
// lead would receive, so a preview that stops matching production
// fails here rather than in a customer's thread.

const db = {
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'ilike']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({
      data: {
        id: 'p1',
        title: '6 BHK Villa in Swiss Town, Devanahalli',
        images: Array.from(
          { length: 15 },
          (_, i) => `property-images/acct/${i}.jpg`
        ),
        property_code: 'PROP-1031',
      },
    });
    return chain;
  },
} as never;

let threadDb: unknown = null;

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'acct-1', supabase: threadDb ?? db }),
  toErrorResponse: (err: unknown) => {
    throw err;
  },
}));

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountShowcaseOrigin: async () => 'https://acme.convoreal.com',
}));

// The owner-intake half of the route imports these at module load; the
// lead paths under test never call them.
vi.mock('@/lib/ai/gemini', () => ({
  generateText: async () => '',
  classifyImageOrText: async () => 'none',
  parseListingFromImageOrText: async () => ({}),
  parseContactFromImageOrText: async () => ({}),
  parseClientReplyFromImageOrText: async () => ({}),
}));

const { POST } = await import('./route');
const { memorySupabase } = await import('@/test/memory-supabase');

function run(
  text: string,
  subjectPropertyCode?: string,
  phone?: string,
  quotedText?: string
) {
  return POST(
    new Request('http://localhost/api/dev/simulate-chatbot', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'lead_reply',
        text,
        subjectPropertyCode,
        phone,
        quotedText,
      }),
    })
  ).then((res) => res.json());
}

// shirish's thread of 7 October 2026: two cards 48 seconds apart, then
// the location question that was answered from the second card only.
const SHARE_CHIKATOGUR =
  'Hi shirish,\n\nI wanted to share a property listing that might interest you:\n\n🏡 *40,000 Sq.Ft. Commercial Plot in Chikatogur, Electronic City Phase 1*\n💰 *₹16 Cr*\n\n📸 Photos & full details:\nhttps://aryavartaventures.convoreal.com/?property_id=PROP-1784&v=0a97fd6d';
const SHARE_JP_8TH =
  'Hi shirish,\n\nI wanted to share a property listing that might interest you:\n\n🏡 *5,760 Sq.Ft. Commercial Property in JP Nagar 8th Phase*\n💰 *₹13.25 Cr*\n\n📸 Photos & full details:\nhttps://aryavartaventures.convoreal.com/?property_id=PROP-2080&v=0a97fd6d';

function shirishThread() {
  return memorySupabase({
    contacts: [
      {
        id: 'c1',
        account_id: 'acct-1',
        name: 'shirish',
        phone: '+919986054104',
        classification: 'Buyer',
        preferred_language: null,
      },
    ],
    conversations: [
      {
        id: 'conv',
        account_id: 'acct-1',
        contact_id: 'c1',
        updated_at: '2026-10-07T15:20:26Z',
      },
    ],
    property_shares: [
      {
        account_id: 'acct-1',
        contact_id: 'c1',
        property_id: 'prop-1784',
        created_at: '2026-10-07T15:01:46Z',
      },
      {
        account_id: 'acct-1',
        contact_id: 'c1',
        property_id: 'prop-2080',
        created_at: '2026-10-07T15:02:34Z',
      },
    ],
    messages: [
      {
        conversation_id: 'conv',
        sender_type: 'agent',
        content_text: SHARE_CHIKATOGUR,
        message_id: 'wamid.share1784',
        created_at: '2026-10-07T15:01:45Z',
      },
      {
        conversation_id: 'conv',
        sender_type: 'agent',
        content_text: SHARE_JP_8TH,
        message_id: 'wamid.share2080',
        created_at: '2026-10-07T15:02:34Z',
      },
      {
        conversation_id: 'conv',
        sender_type: 'customer',
        content_text: 'Is this available?',
        message_id: 'wamid.q1',
        created_at: '2026-10-07T15:20:00Z',
      },
      {
        conversation_id: 'conv',
        sender_type: 'customer',
        content_text: 'Can u share the exact location?',
        message_id: 'wamid.q2',
        created_at: '2026-10-07T15:20:26Z',
      },
    ],
    properties: [
      {
        id: 'prop-1784',
        account_id: 'acct-1',
        property_code: 'PROP-1784',
        title:
          '40,000 Sq.Ft. Commercial Plot in Chikatogur, Electronic City Phase 1',
        type: 'Commercial Land',
        listing_type: 'Sale',
        status: 'Available',
        price: '160000000',
        land_area: '40000',
        land_area_unit: 'Sq.Ft.',
        location: 'Chikatogur, Electronic City Phase 1',
        sublocality: 'Chikkathoguru',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
      {
        id: 'prop-2080',
        account_id: 'acct-1',
        property_code: 'PROP-2080',
        title: '5,760 Sq.Ft. Commercial Property in JP Nagar 8th Phase',
        type: 'Commercial Building',
        listing_type: 'Sale',
        status: 'Available',
        price: '132480000',
        area_sqft: 5760,
        location: 'BK Circle, JP Nagar 8th Phase',
        sublocality: 'Kothnur',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
    ],
    whatsapp_config: [],
    portal_import_items: [],
    bot_instructions: [],
  });
}

describe('simulate-chatbot — lead routing', () => {
  it('previews the photos, not the ladder question, for a photo request', async () => {
    const result = await run('Sir can I get images  images', 'PROP-1031');

    expect(result.route).toBe('photo_request');
    expect(result.ladderStoodDown).toBe(true);
    // The real caps and the real gallery size, off the listing itself.
    expect(result.photoCount).toBe(4);
    expect(result.galleryCount).toBe(15);
    expect(result.previewText).toContain('All 15 photos');
    expect(result.previewText).toContain('property_id=PROP-1031');
    // The reply the carve-out exists to prevent.
    expect(result.previewText).not.toContain(
      'What kind of property are you looking for'
    );
  });

  it('previews the handover when no listing is named, and flags the agent', async () => {
    const result = await run('can I get photos');

    expect(result.route).toBe('photo_request');
    expect(result.notifiesAgent).toBe(true);
    expect(result.photoCount).toBe(0);
    expect(result.previewText).toMatch(/photos/i);
  });

  it('previews the callback line for a callback request', async () => {
    const result = await run('please call me');

    expect(result.route).toBe('callback_handover');
    expect(result.notifiesAgent).toBe(true);
    expect(result.previewText).toContain('call you shortly');
  });

  it('previews the enquiry ack, not the ladder question, for an Enquire tap', async () => {
    const result = await run(
      'Hi! I am interested in your property "6 BHK Villa in Swiss Town, Devanahalli". Please share details. (Property ID: PROP-1031)',
      'PROP-1031'
    );

    expect(result.route).toBe('property_enquiry');
    expect(result.ladderStoodDown).toBe(true);
    expect(result.notifiesAgent).toBe(true);
    expect(result.previewText).toContain('reached our team');
    expect(result.previewText).toContain(
      '*6 BHK Villa in Swiss Town, Devanahalli*'
    );
    // The reply the first live tap actually got.
    expect(result.previewText).not.toMatch(/budget range/i);
  });

  it('previews immediate sharing and agent handoff for a natural property reference', async () => {
    const result = await run(
      '1acre in Akshaynagar i saw I was interested in that',
      'PROP-1031'
    );

    expect(result.route).toBe('property_interest');
    expect(result.ladderStoodDown).toBe(true);
    expect(result.sharesPropertyImmediately).toBe(true);
    expect(result.notifiesAgent).toBe(true);
    expect(result.previewText).toContain(
      '*6 BHK Villa in Swiss Town, Devanahalli*'
    );
    expect(result.previewText).toMatch(/specific questions/i);
    expect(result.previewText).not.toMatch(/start alerts|budget range/i);
  });

  it('marks a numbered listing as answered from the listing itself', async () => {
    const result = await run('option 2');

    expect(result.route).toBe('shortlist_reference');
    expect(result.answeredFromListing).toBe(true);
    // Deliberately not previewed — the wording depends on the question.
    expect(result.previewText).toBeNull();
  });

  it('previews factor prompt and records rejection for a disinterest message', async () => {
    const result = await run('I am not interested', 'PROP-1031');

    expect(result.route).toBe('property_disinterest');
    expect(result.ladderStoodDown).toBe(true);
    expect(result.recordsRejectionFeedback).toBe(true);
    expect(result.promptsRejectionFactors).toBe(true);
    expect(result.previewText).toContain(
      '6 BHK Villa in Swiss Town, Devanahalli'
    );
    expect(result.previewText).toContain('Property Type');
    expect(result.previewText).toContain('Budget / Price');
    expect(result.previewText).toContain('reply by typing');
  });

  it("[INB-034] replays a saved contact's thread and answers the location for both cards", async () => {
    threadDb = shirishThread();
    try {
      const result = await run(
        'Can u share the exact location?',
        undefined,
        '+91 99860 54104'
      );
      expect(result.route).toBe('listing_question');
      expect(result.contactName).toBe('shirish');
      expect(
        result.subjects.map((s: { propertyCode: string }) => s.propertyCode)
      ).toEqual(['PROP-2080', 'PROP-1784']);
      expect(result.previewText).toContain(
        '*5,760 Sq.Ft. Commercial Property in JP Nagar 8th Phase*'
      );
      expect(result.previewText).toContain('JP Nagar 8th Phase');
      expect(result.previewText).toContain(
        '*40,000 Sq.Ft. Commercial Plot in Chikatogur, Electronic City Phase 1*'
      );
      expect(result.previewText).toContain('Chikkathoguru');

      const correction = await run(
        'No this 40,000 sqft one',
        undefined,
        '+919986054104'
      );
      expect(correction.route).toBe('shortlist_reference');
      expect(
        correction.subjects.map((s: { propertyCode: string }) => s.propertyCode)
      ).toEqual(['PROP-1784']);
      expect(correction.questionAnswered).toBe(
        'Can u share the exact location?'
      );
      expect(correction.previewText).toContain('Chikkathoguru');
      expect(correction.previewText).not.toContain('JP Nagar');
    } finally {
      threadDb = null;
    }
  });

  it('[INB-034] follows the card the lead quoted in a replay', async () => {
    threadDb = shirishThread();
    try {
      const result = await run(
        'Is this available?',
        undefined,
        '+919986054104',
        SHARE_CHIKATOGUR
      );
      expect(
        result.subjects.map((s: { propertyCode: string }) => s.propertyCode)
      ).toEqual(['PROP-1784']);
    } finally {
      threadDb = null;
    }
  });

  it('says so when no contact has the phone', async () => {
    threadDb = shirishThread();
    try {
      const result = await run(
        'Is this available?',
        undefined,
        '+91 90000 00000'
      );
      expect(result.error).toBe('No contact has that phone.');
    } finally {
      threadDb = null;
    }
  });

  it('charges no extraction on a carve-out', async () => {
    // Live, these routes return before the ladder pays for Gemini.
    const result = await run('please call me');

    expect(result.preferences).toBeNull();
    expect(result.nextQualifier).toBeNull();
  });
});
