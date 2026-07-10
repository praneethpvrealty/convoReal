import { describe, it, expect } from 'vitest';
import { parseAdCopy, buildAdCopyPrompt, AD_COPY_LIMITS } from '@/lib/meta-ads/ad-copy';

describe('parseAdCopy', () => {
  it('parses clean JSON', () => {
    const raw = '{"primary_text":"Lovely 3BHK in HSR. Message us on WhatsApp for details","headline":"3BHK in HSR Layout","description":"₹1.35 Cr"}';
    expect(parseAdCopy(raw)).toEqual({
      primaryText: 'Lovely 3BHK in HSR. Message us on WhatsApp for details',
      headline: '3BHK in HSR Layout',
      description: '₹1.35 Cr',
    });
  });

  it('tolerates code fences and surrounding prose', () => {
    const raw = 'Here is your copy:\n```json\n{"primary_text":"Great villa plot","headline":"Villa Plot","description":"Prime"}\n```\nHope that helps!';
    const copy = parseAdCopy(raw);
    expect(copy?.headline).toBe('Villa Plot');
  });

  it('clamps overlong fields to the limits at a word boundary', () => {
    const longPrimary = 'This is an extremely long primary text that goes well beyond the one hundred and twenty five character maximum that Meta allows for a single image link ad unit here';
    const raw = JSON.stringify({ primary_text: longPrimary, headline: 'A perfectly fine headline that is definitely too long for forty', description: 'Also a description that is too long' });
    const copy = parseAdCopy(raw)!;
    expect(copy.primaryText.length).toBeLessThanOrEqual(AD_COPY_LIMITS.primaryText);
    expect(copy.headline.length).toBeLessThanOrEqual(AD_COPY_LIMITS.headline);
    expect(copy.description.length).toBeLessThanOrEqual(AD_COPY_LIMITS.description);
    // Word-boundary trim shouldn't leave a dangling partial word / space.
    expect(copy.primaryText.endsWith(' ')).toBe(false);
  });

  it('returns null when there is no JSON object', () => {
    expect(parseAdCopy('I could not generate that, sorry.')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseAdCopy('{primary_text: not valid}')).toBeNull();
  });

  it('returns null when primary_text or headline is empty', () => {
    expect(parseAdCopy('{"primary_text":"","headline":"","description":"x"}')).toBeNull();
    expect(parseAdCopy('{"primary_text":"has text","headline":"","description":"x"}')).toBeNull();
  });

  it('allows an empty description as long as primary+headline exist', () => {
    const copy = parseAdCopy('{"primary_text":"text","headline":"head","description":""}');
    expect(copy).toEqual({ primaryText: 'text', headline: 'head', description: '' });
  });

  it('returns null for empty input', () => {
    expect(parseAdCopy('')).toBeNull();
  });
});

describe('buildAdCopyPrompt', () => {
  it('includes location, price band, and features for a sale listing', () => {
    const prompt = buildAdCopyPrompt({
      title: 'HSR 3BHK',
      type: 'Flat/ Apartment',
      location: 'HSR Layout',
      city: 'Bengaluru',
      listing_type: 'Sale',
      price: 13500000,
      bedrooms: 3,
      area_sqft: 1450,
      features: ['Gym', 'Pool'],
    });
    expect(prompt).toContain('HSR Layout, Bengaluru');
    expect(prompt).toContain('₹1.35 Cr');
    expect(prompt).toContain('3 BHK');
    expect(prompt).toContain('Gym, Pool');
  });

  it('uses rent instead of price for rentals', () => {
    const prompt = buildAdCopyPrompt({ title: 'Rent flat', listing_type: 'Rent', rent_per_month: 35000, price: 99 });
    expect(prompt).toContain('₹35,000/month');
    expect(prompt).not.toContain('Price:');
  });
});
