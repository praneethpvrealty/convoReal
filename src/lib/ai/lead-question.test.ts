import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { QaProperty } from '@/lib/showcase/property-qa';

vi.mock('@/lib/ai/gemini', () => ({
  generateText: vi.fn(),
}));
vi.mock('@/lib/credits/burn', () => ({
  burnCredits: vi.fn(),
}));

import { generateText } from '@/lib/ai/gemini';
import { burnCredits } from '@/lib/credits/burn';
import {
  answerLeadQuestion,
  answerFromSellerFinalPrice,
  answerFromPortalListing,
  looksLikeQuestion,
  requestsHumanContact,
  HANDOVER_TEXT,
  CALLBACK_HANDOVER_TEXT,
  mergeLeadAnswers,
} from './lead-question';

const property = {
  title: 'Commercial Plot on 19th Main',
  type: 'Commercial Land',
  listing_type: 'Sale',
  price: 345000000,
  location: 'HSR Layout',
  sublocality: 'HSR Layout',
  city: 'Bengaluru',
  area_sqft: 4000,
  area_unit: 'Sq.Ft.',
  facing_direction: 'North',
  features: ['Fenced Boundary', 'Access Road'],
  nearby_highlights: ['Metro Station', 'School'],
} as unknown as QaProperty;

describe('looksLikeQuestion', () => {
  it('recognises the question that was mistaken for a booking', () => {
    expect(looksLikeQuestion('Can we see inside when we visit tomorrow')).toBe(
      true
    );
  });

  it('recognises questions with and without a question mark', () => {
    expect(looksLikeQuestion('is it north facing?')).toBe(true);
    expect(looksLikeQuestion('what is the price')).toBe(true);
    expect(looksLikeQuestion('Which one is the one we are talking here.')).toBe(
      true
    );
  });

  it('leaves outright instructions to the scheduler', () => {
    expect(looksLikeQuestion('book a site visit tomorrow at 10')).toBe(false);
    expect(looksLikeQuestion('can you schedule a visit for Saturday')).toBe(
      false
    );
    expect(looksLikeQuestion('remind me on Monday')).toBe(false);
  });

  it('ignores statements and empty text', () => {
    expect(looksLikeQuestion('Please send')).toBe(false);
    expect(looksLikeQuestion('')).toBe(false);
    expect(looksLikeQuestion(null)).toBe(false);
  });
});

describe('requestsHumanContact', () => {
  it('recognises the ask that was answered with a budget question', () => {
    // The reported bug: "Call me" reached the qualification ladder and
    // came back "Noted — residential plot. What budget range are you
    // working with?".
    expect(requestsHumanContact('Call me')).toBe(true);
  });

  it('recognises the ways a lead asks for a person', () => {
    for (const text of [
      'call me',
      'Please call',
      'pls call me tomorrow',
      'give me a call',
      'ring me in the evening',
      'can you call back',
      'I want to talk to someone',
      'let me speak with an agent',
      'connect me to your team',
    ]) {
      expect(requestsHumanContact(text), text).toBe(true);
    }
  });

  it('does not fire when the lead says THEY will call', () => {
    // "I'll call you" is the lead taking the action. Treating it as a
    // request would summon an agent and promise a call nobody owes.
    expect(requestsHumanContact("I'll call you tomorrow")).toBe(false);
    expect(requestsHumanContact('I will call you back later')).toBe(false);
  });

  it('leaves ordinary requirement talk to the ladder', () => {
    for (const text of [
      '3 BHK in Whitefield',
      'budget is 2cr',
      'send me photos',
      '',
      null,
    ]) {
      expect(requestsHumanContact(text), String(text)).toBe(false);
    }
  });
});

describe('answerLeadQuestion', () => {
  beforeEach(() => {
    vi.mocked(burnCredits).mockResolvedValue({ deficit: 0 } as never);
    vi.mocked(generateText).mockResolvedValue('');
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hands a callback request to a person, listing or no listing', async () => {
    // source 'handover' is what the webhook keys the notification, the
    // reply bridge and the pending status off. Answering "call me" as
    // anything else promises a call nobody is told to make.
    for (const subject of [property, null]) {
      const res = await answerLeadQuestion({
        accountId: 'a1',
        question: 'Call me',
        property: subject,
      });
      expect(res.source).toBe('handover');
      expect(res.text).toBe(CALLBACK_HANDOVER_TEXT);
    }
    expect(generateText).not.toHaveBeenCalled();
    expect(burnCredits).not.toHaveBeenCalled();
  });

  it('answers from the listing fields without spending a credit', async () => {
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'which direction does it face?',
      property,
    });
    expect(res.source).toBe('listing');
    expect(res.text).toMatch(/north/i);
    expect(burnCredits).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('falls to Gemini for an open-ended question, grounded in the listing', async () => {
    vi.mocked(generateText).mockResolvedValue(
      'The owner is open to discussing the price.'
    );
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'is the price negotiable at all',
      property,
    });
    expect(res.source).toBe('ai');
    expect(res.text).toContain('open to discussing');
    const [prompt] = vi.mocked(generateText).mock.calls[0];
    expect(prompt).toContain('Commercial Plot on 19th Main');
  });

  it('hands over when Gemini refuses rather than inventing', async () => {
    vi.mocked(generateText).mockResolvedValue(
      "I don't have that information about this property."
    );
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'can we see inside when we visit tomorrow',
      property,
    });
    expect(res.source).toBe('handover');
    expect(res.text).toBe(HANDOVER_TEXT);
  });

  it('hands over — without calling Gemini — when credits are short', async () => {
    vi.mocked(burnCredits).mockResolvedValue({ deficit: 2 } as never);
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'is the price negotiable at all',
      property,
    });
    expect(res.source).toBe('handover');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('hands over when the AI call throws', async () => {
    vi.mocked(generateText).mockRejectedValue(new Error('upstream down'));
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'is the price negotiable at all',
      property,
    });
    expect(res.source).toBe('handover');
  });

  it('hands over when no listing can be pinned to the question', async () => {
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'is it north facing?',
      property: null,
    });
    expect(res.source).toBe('handover');
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe('answerFromSellerFinalPrice', () => {
  it('answers the negotiability question from the stored rate', () => {
    const answer = answerFromSellerFinalPrice('Is this negotiable???', {
      seller_final_price_per_sqft: 10500,
      seller_final_price: null,
      area_sqft: 4200,
    });
    expect(answer).toContain('₹10,500 per sq.ft.');
    // Derived only as a convenience — the rate is what was stated.
    expect(answer).toContain('₹4,41,00,000');
  });

  it('omits the derived total when no area is known', () => {
    const answer = answerFromSellerFinalPrice('any room on the price?', {
      seller_final_price_per_sqft: 10500,
      seller_final_price: null,
      area_sqft: undefined,
    });
    expect(answer).toContain('₹10,500 per sq.ft.');
    expect(answer).not.toContain('for this unit');
  });

  it('falls back to the stored total', () => {
    expect(
      answerFromSellerFinalPrice('whats the best price', {
        seller_final_price: 42000000,
        seller_final_price_per_sqft: null,
        area_sqft: 4200,
      })
    ).toContain('₹4,20,00,000');
  });

  it('stays silent when the listing carries no final price', () => {
    expect(
      answerFromSellerFinalPrice('is it negotiable', {
        seller_final_price: null,
        seller_final_price_per_sqft: null,
        area_sqft: 4200,
      })
    ).toBeNull();
  });

  it('stays silent for a question that is not about negotiation', () => {
    expect(
      answerFromSellerFinalPrice('is it north facing?', {
        seller_final_price_per_sqft: 10500,
        seller_final_price: null,
        area_sqft: 4200,
      })
    ).toBeNull();
  });
});

describe('answerLeadQuestion — seller final price rung', () => {
  const withFinal = {
    ...property,
    seller_final_price_per_sqft: 10500,
    seller_final_price: null,
  } as unknown as QaProperty;

  beforeEach(() => {
    vi.mocked(burnCredits).mockResolvedValue({
      success: true,
      deficit: 0,
      balanceAfter: 100,
    } as unknown as Awaited<ReturnType<typeof burnCredits>>);
  });

  it('answers from the listing without a model call when the account opted in', async () => {
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'Is this negotiable???',
      property: withFinal,
      shareSellerFinalPrice: true,
    });
    expect(res.source).toBe('listing');
    expect(res.intent).toBe('seller_final_price');
    expect(res.text).toContain('₹10,500 per sq.ft.');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('keeps the floor internal when the account has not opted in', async () => {
    vi.mocked(generateText).mockResolvedValue("I don't know that.");
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'Is this negotiable???',
      property: withFinal,
    });
    expect(res.text).toBe(HANDOVER_TEXT);
    expect(res.text).not.toContain('10,500');
  });
});

describe('answerFromPortalListing', () => {
  const property = {
    price: 44_100_000,
    area_sqft: 4200,
    title: 'Oval Reef Plot',
  };

  it('answers the MagicBricks question with both figures instead of denying knowledge', () => {
    const answer = answerFromPortalListing(
      'It says as 4000sqft in magicbricks. Is it thecsame one???',
      property,
      [{ portal: 'magicbricks', areaSqft: 4000 }]
    );
    expect(answer).toContain('same property');
    expect(answer).toContain('MagicBricks shows 4,000 sq.ft.');
    expect(answer).toContain('our records show 4,200 sq.ft.');
    // The persona break that started this: never a third party.
    expect(answer).not.toContain('the agent');
    expect(answer).not.toContain("don't have information");
  });

  it('confirms plainly when the portal copy agrees', () => {
    const answer = answerFromPortalListing(
      'is this the same as the magicbricks one?',
      property,
      [{ portal: 'magicbricks', areaSqft: 4200, price: 44_100_000 }]
    );
    expect(answer).toContain('same property');
    expect(answer).not.toContain('•');
  });

  it('stays out of the way when the named portal has no linked copy', () => {
    expect(
      answerFromPortalListing('what about 99acres?', property, [
        { portal: 'magicbricks', areaSqft: 4000 },
      ])
    ).toBeNull();
  });

  it('stays out of the way when no portal is named', () => {
    expect(
      answerFromPortalListing('is it north facing?', property, [
        { portal: 'magicbricks', areaSqft: 4000 },
      ])
    ).toBeNull();
  });
});

describe('answerLeadQuestion — portal rung and persona', () => {
  beforeEach(() => {
    vi.mocked(burnCredits).mockResolvedValue({ deficit: 0 } as never);
    vi.mocked(generateText).mockResolvedValue('');
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reconciles against the portal without spending a model call', async () => {
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'It says as 4000sqft in magicbricks. Is it thecsame one???',
      property: { ...property, area_sqft: 4200 } as unknown as QaProperty,
      portalListings: [{ portal: 'magicbricks', areaSqft: 4000 }],
    });
    expect(res.source).toBe('listing');
    expect(res.intent).toBe('portal_compare');
    expect(res.text).toContain('MagicBricks shows 4,000 sq.ft.');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('treats a first-person deferral as a handover, so an agent is still told', async () => {
    // The prompt now asks for this shape instead of "I don't know";
    // scoring it as a real answer would skip the agent notification.
    vi.mocked(generateText).mockResolvedValue(
      'Let me confirm that and come right back to you.'
    );
    const res = await answerLeadQuestion({
      accountId: 'a1',
      question: 'can we see inside when we visit tomorrow',
      property,
    });
    expect(res.source).toBe('handover');
  });
});

describe('mergeLeadAnswers', () => {
  const one = {
    text: 'It is in Koramangala 5th block.',
    source: 'listing' as const,
    intent: 'location',
  };
  const two = {
    text: 'It is in JP Nagar 4th Phase.',
    source: 'listing' as const,
    intent: 'location',
  };

  it('leaves a single answer exactly as it is', () => {
    expect(mergeLeadAnswers([one], [{ title: 'Plot A' }])).toBe(one);
  });

  it('heads each answer with its listing, so two localities are tellable apart', () => {
    const merged = mergeLeadAnswers(
      [one, two],
      [
        { title: 'Residential Plot in Koramangala' },
        { title: '2400 Sqft Commercial Plot' },
      ]
    );
    expect(merged.text).toBe(
      '*Residential Plot in Koramangala*\nIt is in Koramangala 5th block.\n\n' +
        '*2400 Sqft Commercial Plot*\nIt is in JP Nagar 4th Phase.'
    );
    expect(merged.source).toBe('listing');
    expect(merged.intent).toBe('location');
  });

  it('collapses the same answer rather than promising a callback twice', () => {
    const callback = {
      text: CALLBACK_HANDOVER_TEXT,
      source: 'handover' as const,
    };
    expect(
      mergeLeadAnswers(
        [callback, { ...callback }],
        [{ title: 'A' }, { title: 'B' }]
      ).text
    ).toBe(CALLBACK_HANDOVER_TEXT);
  });

  it('is a handover when any one listing needs a person', () => {
    const merged = mergeLeadAnswers(
      [one, { text: HANDOVER_TEXT, source: 'handover' as const }],
      [{ title: 'A' }, { title: 'B' }]
    );
    expect(merged.source).toBe('handover');
    expect(merged.intent).toBeNull();
  });

  it('hands over when nothing could be resolved at all', () => {
    expect(mergeLeadAnswers([], []).source).toBe('handover');
  });
});
