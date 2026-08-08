import { describe, it, expect } from 'vitest';
import { extractEnquiredPropertyFromNote } from './enquiry-note';

describe('extractEnquiredPropertyFromNote', () => {
  it('recovers the requirement from the MagicBricks blurb', () => {
    expect(
      extractEnquiredPropertyFromNote(
        'This user is looking for 3 BHK Residential House for Sale in Block 3rd Koramangala, Bangalore and has viewed your contact details.'
      )
    ).toBe(
      '3 BHK Residential House for Sale in Block 3rd Koramangala, Bangalore'
    );
  });

  it('drops the duplicated locality the portal writes', () => {
    expect(
      extractEnquiredPropertyFromNote(
        'This user is looking for 2 BHK Multistorey Apartment for Sale in Kumaraswamy Layout, Kumaraswamy Layout, Bangalore and has viewed your contact details.'
      )
    ).toBe(
      '2 BHK Multistorey Apartment for Sale in Kumaraswamy Layout, Bangalore'
    );
  });

  it('keeps distinct localities that merely repeat later', () => {
    // Only consecutive repetition is portal noise.
    expect(
      extractEnquiredPropertyFromNote(
        'looking for Plot in Whitefield, Hoskote, Whitefield Road, Bangalore'
      )
    ).toBe('Plot in Whitefield, Hoskote, Whitefield Road, Bangalore');
  });

  it('survives a different portal trailer', () => {
    expect(
      extractEnquiredPropertyFromNote(
        'This user is looking for Office Space in HSR Layout and has contacted you via 99acres.'
      )
    ).toBe('Office Space in HSR Layout');
  });

  it('takes the whole phrase when there is no trailer', () => {
    expect(
      extractEnquiredPropertyFromNote(
        'This user is looking for Residential Plot for Sale in Benjana Padavu, Mangalore.'
      )
    ).toBe('Residential Plot for Sale in Benjana Padavu, Mangalore');
  });

  it('returns null for notes that never state a requirement', () => {
    expect(
      extractEnquiredPropertyFromNote('Called twice, no answer')
    ).toBeNull();
    expect(extractEnquiredPropertyFromNote('')).toBeNull();
    expect(extractEnquiredPropertyFromNote(null)).toBeNull();
    expect(extractEnquiredPropertyFromNote(undefined)).toBeNull();
  });

  it('returns null when the phrase is present but empty', () => {
    // "looking for and has viewed..." strips down to nothing — the
    // caller must fall back to the generic template, not send
    // "Property: " with a hole after it.
    expect(
      extractEnquiredPropertyFromNote(
        'This user is looking for and has viewed your contact details.'
      )
    ).toBeNull();
  });

  it('flattens newlines — Meta rejects params containing them', () => {
    const out = extractEnquiredPropertyFromNote(
      'looking for 2 BHK\nin Whitefield,\nBangalore'
    );
    expect(out).toBe('2 BHK in Whitefield, Bangalore');
    expect(out).not.toContain('\n');
  });

  it('caps a runaway description instead of failing the send', () => {
    const out = extractEnquiredPropertyFromNote(
      `looking for ${'very '.repeat(100)}large plot`
    );
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(200);
  });

  it('matches case-insensitively', () => {
    expect(
      extractEnquiredPropertyFromNote('Looking For 2 BHK in Indiranagar')
    ).toBe('2 BHK in Indiranagar');
  });
});
