import { describe, expect, it } from 'vitest';

import { LOST_REASONS, lostReasonLabel, parseLostReason } from './lost-reasons';

describe('[TXW-025] lost reasons', () => {
  it('accepts a listed reason with an optional note', () => {
    expect(parseLostReason({ lost_reason: 'Price disagreement' })).toEqual({
      ok: true,
      value: { lost_reason: 'Price disagreement', lost_note: null },
    });
    expect(
      parseLostReason({
        lost_reason: 'Owner backed out',
        lost_note: '  sold  ',
      })
    ).toEqual({
      ok: true,
      value: { lost_reason: 'Owner backed out', lost_note: 'sold' },
    });
  });

  it('asks for a note when the reason is Other', () => {
    expect(parseLostReason({ lost_reason: 'Other' }).ok).toBe(false);
    expect(
      parseLostReason({ lost_reason: 'Other', lost_note: 'Vastu' }).ok
    ).toBe(true);
  });

  it('refuses reasons that are not on the list and passes none through', () => {
    expect(parseLostReason({ lost_reason: 'Bored' }).ok).toBe(false);
    expect(parseLostReason({})).toEqual({ ok: true, value: null });
  });

  it('covers the three ways a deal can fail after the owner meeting', () => {
    expect(LOST_REASONS).toContain('Price disagreement');
    expect(LOST_REASONS).toContain('Terms disagreement');
    expect(LOST_REASONS).toContain('Owner backed out');
  });

  it('labels a lost deal with its reason and note', () => {
    expect(
      lostReasonLabel({ lost_reason: 'Buyer backed out', lost_note: 'loan' })
    ).toBe('Buyer backed out: loan');
    expect(lostReasonLabel({ lost_reason: null })).toBeNull();
  });
});
