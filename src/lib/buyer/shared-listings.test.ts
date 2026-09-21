import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPortfolioNudge,
  portfolioLoginUrl,
  sharedShortlistRows,
} from './shared-listings';

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe('portfolioLoginUrl', () => {
  it('[CTM-004] points at the Portfolio sign-in on the platform site', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.convoreal.com/';
    expect(portfolioLoginUrl()).toBe('https://app.convoreal.com/buyer/login');
  });
});

describe('buildPortfolioNudge', () => {
  it('[CTM-004] tells a linked buyer the listings are already in their Portfolio', () => {
    expect(
      buildPortfolioNudge({
        linked: true,
        url: 'https://convoreal.com/buyer/login',
        count: 3,
      })
    ).toBe(
      'These are saved in your Portfolio too — open it any time to compare, keep or drop them, and tell me which ones to line up:\nhttps://convoreal.com/buyer/login'
    );
  });

  it('[CTM-004] tells a buyer without an account to sign in with this number', () => {
    expect(
      buildPortfolioNudge({
        linked: false,
        url: 'https://convoreal.com/buyer/login',
        count: 1,
      })
    ).toBe(
      'This one is saved to your Portfolio as well — sign in with this WhatsApp number to keep track of them, compare, and tell me which ones to line up:\nhttps://convoreal.com/buyer/login'
    );
  });
});

describe('sharedShortlistRows', () => {
  it('[CTM-004] mirrors shares onto linked buyers only, once per property', () => {
    const rows = sharedShortlistRows(
      [{ buyerUserId: 'bu-1', accountId: 'acc-1', contactId: 'c-1' }],
      [
        { contactId: 'c-1', propertyId: 'p-1' },
        { contactId: 'c-1', propertyId: 'p-1' },
        { contactId: 'c-1', propertyId: 'p-2' },
        { contactId: 'c-9', propertyId: 'p-3' },
      ]
    );
    expect(rows).toEqual([
      {
        buyer_user_id: 'bu-1',
        account_id: 'acc-1',
        property_id: 'p-1',
        contact_id: 'c-1',
        source: 'shared',
      },
      {
        buyer_user_id: 'bu-1',
        account_id: 'acc-1',
        property_id: 'p-2',
        contact_id: 'c-1',
        source: 'shared',
      },
    ]);
  });
});
