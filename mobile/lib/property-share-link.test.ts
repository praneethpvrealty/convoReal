import { describe, it, expect } from 'vitest';
import { propertyShareUrl } from './property-share-link';
import type { Property } from '@/lib/types';

const SITE = 'https://www.convoreal.com';
const ACCOUNT = '4f1247de-269c-47c2-8974-36ef8f77f77d';

const property = { id: 'p-uuid', property_code: 'PROP-1151' } as Property;

describe('propertyShareUrl', () => {
  it('puts the link on the account subdomain', () => {
    expect(
      propertyShareUrl({
        siteUrl: SITE,
        subdomain: 'aryavartaventures',
        accountId: ACCOUNT,
        property,
        audience: 'client',
      })
    ).toBe('https://aryavartaventures.convoreal.com/?property_id=PROP-1151');
  });

  it('scopes the shared domain with ref when the account has no subdomain', () => {
    const url = propertyShareUrl({
      siteUrl: SITE,
      subdomain: null,
      accountId: ACCOUNT,
      property,
      audience: 'client',
    });
    expect(url).toBe(
      `https://www.convoreal.com/?ref=${ACCOUNT}&property_id=PROP-1151`
    );
  });

  it('sends a co-broker to the view-only page', () => {
    expect(
      propertyShareUrl({
        siteUrl: SITE,
        subdomain: 'aryavartaventures',
        accountId: ACCOUNT,
        property,
        audience: 'agent',
      })
    ).toBe(
      'https://aryavartaventures.convoreal.com/?property_id=PROP-1151&mode=view'
    );
  });

  it('falls back to the id for a listing with no code', () => {
    expect(
      propertyShareUrl({
        siteUrl: SITE,
        subdomain: 'aryavartaventures',
        accountId: ACCOUNT,
        property: { id: 'p-uuid' } as Property,
        audience: 'client',
      })
    ).toBe('https://aryavartaventures.convoreal.com/?property_id=p-uuid');
  });
});
