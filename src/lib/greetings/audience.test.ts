import { describe, expect, it } from 'vitest';
import { parseGreetingAudience } from './audience';

describe('parseGreetingAudience', () => {
  it('keeps the backwards-compatible all-contacts default', () => {
    expect(parseGreetingAudience(undefined)).toEqual({
      audience: { type: 'all' },
    });
  });

  it('accepts and de-duplicates selected contacts', () => {
    expect(
      parseGreetingAudience({
        type: 'contacts',
        contactIds: ['contact-1', 'contact-2', 'contact-1'],
      })
    ).toEqual({
      audience: {
        type: 'contacts',
        contactIds: ['contact-1', 'contact-2'],
      },
    });
  });

  it('refuses an empty selected-contact audience', () => {
    expect(
      parseGreetingAudience({ type: 'contacts', contactIds: [] })
    ).toEqual({
      error: 'Pick at least one contact for a selected audience',
    });
  });

  it('refuses unknown audience types instead of broadening to all contacts', () => {
    expect(parseGreetingAudience({ type: 'everyone' })).toEqual({
      error: 'Choose a valid greeting audience',
    });
  });
});
