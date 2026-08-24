import { describe, expect, it } from 'vitest';

import {
  parsePublicProfilePatch,
  PUBLIC_PROFILE_DESCRIPTION_MAX,
} from './public-profile-settings';

describe('parsePublicProfilePatch', () => {
  it('trims copy and removes duplicate or blank list entries', () => {
    expect(
      parsePublicProfilePatch({
        description: '  Independent real estate advisory  ',
        areasServed: [' Bengaluru ', '', 'bengaluru', 'Koramangala'],
        propertyExpertise: [],
      })
    ).toEqual({
      ok: true,
      value: {
        description: 'Independent real estate advisory',
        areasServed: ['Bengaluru', 'Koramangala'],
        propertyExpertise: null,
      },
    });
  });

  it('rejects invalid types, oversized copy, and more than twelve entries', () => {
    expect(parsePublicProfilePatch({ areasServed: 'Bengaluru' })).toMatchObject(
      {
        ok: false,
      }
    );
    expect(
      parsePublicProfilePatch({
        description: 'x'.repeat(PUBLIC_PROFILE_DESCRIPTION_MAX + 1),
      })
    ).toMatchObject({ ok: false });
    expect(
      parsePublicProfilePatch({
        propertyExpertise: Array.from({ length: 13 }, (_, i) => `Type ${i}`),
      })
    ).toMatchObject({ ok: false });
  });

  it('requires at least one supported field', () => {
    expect(parsePublicProfilePatch({})).toEqual({
      ok: false,
      error: 'No public profile fields were provided',
    });
  });
});
