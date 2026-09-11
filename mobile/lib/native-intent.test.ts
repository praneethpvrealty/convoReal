import { describe, expect, it } from 'vitest';

import { redirectSystemPath } from '../app/+native-intent';

const propertyId = '22222222-2222-4222-8222-222222222222';

describe('mobile audience-sharing links', () => {
  it('keeps the audience picker request in a custom app link', () => {
    expect(
      redirectSystemPath({
        path: `convoreal:///property/${propertyId}?audience=1`,
        initial: true,
      })
    ).toBe(`/property/${propertyId}?audience=1`);
  });

  it('maps the web handoff to the same picker in the app', () => {
    expect(
      redirectSystemPath({
        path: `https://www.convoreal.com/inventory?sharePropertyId=${propertyId}&shareAudience=1`,
        initial: true,
      })
    ).toBe(`/property/${propertyId}?audience=1`);
  });
});
