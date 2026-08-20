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

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'acct-1', supabase: db }),
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
  classifyImageOrText: async () => 'none',
  parseListingFromImageOrText: async () => ({}),
  parseContactFromImageOrText: async () => ({}),
  parseClientReplyFromImageOrText: async () => ({}),
}));

const { POST } = await import('./route');

function run(text: string, subjectPropertyCode?: string) {
  return POST(
    new Request('http://localhost/api/dev/simulate-chatbot', {
      method: 'POST',
      body: JSON.stringify({ mode: 'lead_reply', text, subjectPropertyCode }),
    })
  ).then((res) => res.json());
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

  it('charges no extraction on a carve-out', async () => {
    // Live, these routes return before the ladder pays for Gemini.
    const result = await run('please call me');

    expect(result.preferences).toBeNull();
    expect(result.nextQualifier).toBeNull();
  });
});
