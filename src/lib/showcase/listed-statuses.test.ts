import { describe, expect, it } from 'vitest';
import { isListedOnShowcase } from './listed-statuses';

describe('isListedOnShowcase', () => {
  it('[PRP-052] is true for a published Available or Under Contract listing', () => {
    expect(
      isListedOnShowcase({ is_published: true, status: 'Available' })
    ).toBe(true);
    expect(
      isListedOnShowcase({ is_published: true, status: 'Under Contract' })
    ).toBe(true);
  });

  it('[PRP-052] is false for an unpublished or off-market listing', () => {
    expect(
      isListedOnShowcase({ is_published: false, status: 'Available' })
    ).toBe(false);
    expect(isListedOnShowcase({ is_published: true, status: 'Sold' })).toBe(
      false
    );
    expect(
      isListedOnShowcase({ is_published: true, status: 'Pending Review' })
    ).toBe(false);
    expect(isListedOnShowcase({ is_published: true, status: null })).toBe(
      false
    );
  });
});
