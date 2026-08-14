import { describe, expect, it } from 'vitest';

import { publicListingIntakeUrl } from '@/lib/inventory/listing-intake';

describe('publicListingIntakeUrl', () => {
  it('points at the account on the bare site', () => {
    expect(publicListingIntakeUrl('https://convoreal.com', null, 'acc-1')).toBe(
      'https://convoreal.com/list?ref=acc-1'
    );
  });

  // A brokerage with its own subdomain sends links on it, not on the
  // marketing domain — the same rule showcase links follow.
  it("uses the account's own subdomain when it has one", () => {
    expect(
      publicListingIntakeUrl(
        'https://convoreal.com',
        'aryavartaventures',
        'acc-1'
      )
    ).toBe('https://aryavartaventures.convoreal.com/list?ref=acc-1');
  });

  // The page resolves the account from `ref`, not from the host, so it
  // is carried even on a subdomain.
  it('always carries ref', () => {
    expect(
      publicListingIntakeUrl('https://convoreal.com', 'brand', 'acc-2')
    ).toContain('ref=acc-2');
  });

  it('survives a dev origin with a port', () => {
    expect(publicListingIntakeUrl('http://localhost:3000', null, 'acc-1')).toBe(
      'http://localhost:3000/list?ref=acc-1'
    );
  });
});
