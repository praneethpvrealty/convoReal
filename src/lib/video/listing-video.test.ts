import { describe, it, expect } from 'vitest';
import {
  buildCaptions,
  buildNarrationScript,
  formatIndianAmount,
  isNarrationLanguage,
  NARRATION_LANGUAGES,
} from './listing-video';

const devanahalli = {
  title: '3-Floor Investment Building',
  type: 'Residential House',
  bedrooms: 3,
  city: 'Bangalore',
  sublocality: 'Devanahalli',
  price: 30000000,
  listing_type: 'Sale',
};

describe('formatIndianAmount', () => {
  it('speaks crores, lakhs, and plain rupees', () => {
    expect(formatIndianAmount(30000000)).toBe('3 crore rupees');
    expect(formatIndianAmount(8000000)).toBe('80 lakh rupees');
    expect(formatIndianAmount(80000)).toBe('80,000 rupees');
    expect(formatIndianAmount(12500000)).toBe('1.25 crore rupees');
  });
});

describe('buildNarrationScript', () => {
  it('mentions title, locality, price, and the WhatsApp CTA', () => {
    const s = buildNarrationScript(devanahalli);
    expect(s).toContain('3-Floor Investment Building');
    expect(s).toContain('Devanahalli, Bangalore');
    expect(s).toContain('3 crore rupees');
    expect(s).toContain('WhatsApp');
  });

  it('uses monthly rent for rental listings', () => {
    const s = buildNarrationScript({ ...devanahalli, listing_type: 'Rent', rent_per_month: 80000 });
    expect(s).toContain('Monthly rent 80,000 rupees');
    expect(s).not.toContain('crore');
  });

  it('never mentions a price it does not have', () => {
    const s = buildNarrationScript({ title: 'Plot', type: 'Plot', price: null });
    expect(s).not.toMatch(/rupees/);
  });
});

describe('buildCaptions', () => {
  it('headlines with the title then rotates true facts', () => {
    const caps = buildCaptions(devanahalli, 5);
    expect(caps).toHaveLength(5);
    expect(caps[0]).toBe('3-Floor Investment Building');
    expect(caps[1]).toBe('In Devanahalli, Bangalore');
    expect(caps[2]).toContain('3 BHK');
  });
});

describe('isNarrationLanguage', () => {
  it('accepts the 11 supported codes and rejects others', () => {
    expect(Object.keys(NARRATION_LANGUAGES)).toHaveLength(11);
    expect(isNarrationLanguage('kn-IN')).toBe(true);
    expect(isNarrationLanguage('fr-FR')).toBe(false);
    expect(isNarrationLanguage(null)).toBe(false);
  });
});
