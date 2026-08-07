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
  looksLikeQuestion,
  HANDOVER_TEXT,
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
    expect(looksLikeQuestion('Can we see inside when we visit tomorrow')).toBe(true);
  });

  it('recognises questions with and without a question mark', () => {
    expect(looksLikeQuestion('is it north facing?')).toBe(true);
    expect(looksLikeQuestion('what is the price')).toBe(true);
    expect(looksLikeQuestion('Which one is the one we are talking here.')).toBe(true);
  });

  it('leaves outright instructions to the scheduler', () => {
    expect(looksLikeQuestion('book a site visit tomorrow at 10')).toBe(false);
    expect(looksLikeQuestion('can you schedule a visit for Saturday')).toBe(false);
    expect(looksLikeQuestion('remind me on Monday')).toBe(false);
  });

  it('ignores statements and empty text', () => {
    expect(looksLikeQuestion('Please send')).toBe(false);
    expect(looksLikeQuestion('')).toBe(false);
    expect(looksLikeQuestion(null)).toBe(false);
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
    vi.mocked(generateText).mockResolvedValue('The owner is open to discussing the price.');
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
      "I don't have that information about this property.",
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
