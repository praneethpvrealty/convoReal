import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const state = vi.hoisted(() => ({
  host: 'www.convoreal.com',
  sellerPage: null as { accountId: string; contactId: string } | null,
  subdomainAccount: null as string | null,
  targetProperty: null as Record<string, unknown> | null,
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (key: string) => (key === 'host' ? state.host : null),
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
}));

vi.mock('next/cache', () => ({
  unstable_cache: <T,>(fn: T) => fn,
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({}),
}));

vi.mock('@/lib/showcase/deal-floor-fonts', () => ({
  dealFloorFontClassName: 'deal-floor-font',
}));

vi.mock('@/components/showcase/showcase-view', () => ({
  ShowcaseView: function ShowcaseView() {
    return null;
  },
}));

vi.mock('@/components/showcase/authority-links', () => ({
  AuthorityLinks: function AuthorityLinks() {
    return null;
  },
}));

vi.mock('@/components/landing/marketing-landing', () => ({
  MarketingLanding: function MarketingLanding() {
    return null;
  },
}));

vi.mock('@/lib/inventory/share-grants', () => ({
  grantedReveals: () => ({}),
  resolveShareGrant: async () => null,
  trackGrantView: async () => undefined,
}));

const listing = (
  id: string,
  owner: string | null,
  source: string = 'owner'
) => ({
  id,
  account_id: 'acct-1',
  user_id: 'staff-1',
  owner_contact_id: owner,
  listing_source: source,
  title: `Listing ${id}`,
  is_published: true,
  status: 'Available',
  price: 100,
});

vi.mock('@/lib/showcase/public-data', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/showcase/public-data')>();
  return {
    resolveSubdomainFromHost: actual.resolveSubdomainFromHost,
    cachedResolveSellerPage: async () => state.sellerPage,
    cachedResolveAccountFromSubdomain: async () => state.subdomainAccount,
    cachedResolvePropertyById: async () => state.targetProperty,
    cachedResolveShowcaseRef: async () => null,
    cachedFetchFallbackAccount: async () => 'fallback-acct',
    cachedFetchShowcaseData: async (accountId: string) => ({
      settings: { contact_phone: '+91 90000 00000' },
      accountName: accountId === 'acct-1' ? 'Acme Realty' : 'Other Realty',
      engineWhatsAppPhone: null,
      properties: [
        listing('own-1', 'seller-contact'),
        listing('own-2', 'seller-contact', 'whatsapp_lister'),
        listing('cobroke', 'seller-contact', 'agent'),
        listing('agency', 'someone-else'),
      ],
      underContract: [],
      agents: [],
      profiles: [],
      services: [],
      articles: [],
    }),
    toPublicProperties: actual.toPublicProperties,
  };
});

import RootPage, { generateMetadata } from './page';

function findShowcaseView(node: ReactNode): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findShowcaseView(child);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  const type = element.type as { name?: string } | string;
  if (typeof type === 'function' && type.name === 'ShowcaseView') {
    return element;
  }
  return findShowcaseView(element.props?.children);
}

function hasAuthorityLinks(node: ReactNode): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasAuthorityLinks);
  const element = node as ReactElement<{ children?: ReactNode }>;
  const type = element.type as { name?: string } | string;
  if (typeof type === 'function' && type.name === 'AuthorityLinks') return true;
  return hasAuthorityLinks(element.props?.children);
}

async function renderSellerPage(params: Record<string, string>) {
  const tree = await RootPage({ searchParams: Promise.resolve(params) });
  const view = findShowcaseView(tree);
  expect(view).not.toBeNull();
  return {
    tree,
    props: view!.props as {
      accountId: string;
      properties: Array<{ id: string }>;
      referrerContactId?: string;
      referrerPhone?: string;
      sellerPageSlug?: string;
      initialPropertyId?: string;
      initialAgentMode?: boolean;
    },
  };
}

beforeEach(() => {
  state.host = 'www.convoreal.com';
  state.sellerPage = { accountId: 'acct-1', contactId: 'seller-contact' };
  state.subdomainAccount = null;
  state.targetProperty = null;
});

describe('seller page render', () => {
  it('[SLP-001] shows only the seller’s own non-agent listings', async () => {
    const { props } = await renderSellerPage({ __seller: 'bcdfghjkmn' });
    expect(props.accountId).toBe('acct-1');
    expect(props.properties.map((p) => p.id)).toEqual(['own-1', 'own-2']);
    expect(props.sellerPageSlug).toBe('bcdfghjkmn');
  });

  it('[SLP-001] never falls back to the agency catalogue when the seller has nothing live', async () => {
    state.sellerPage = { accountId: 'acct-1', contactId: 'nobody' };
    const { props, tree } = await renderSellerPage({ __seller: 'bcdfghjkmn' });
    expect(props.properties).toEqual([]);
    expect(hasAuthorityLinks(tree)).toBe(false);
  });

  it('[SLP-002] keeps the agency as the contact and never hands the seller id to the client', async () => {
    const { props } = await renderSellerPage({
      __seller: 'bcdfghjkmn',
      ref: 'seller-contact',
      mode: 'view',
    });
    expect(props.referrerContactId).toBeUndefined();
    expect(props.referrerPhone).toBeUndefined();
    expect(props.initialAgentMode).toBe(false);
    expect(JSON.stringify(props)).not.toContain('seller-contact');
  });

  it('[SLP-003] returns 404 for an unknown or retired slug', async () => {
    state.sellerPage = null;
    await expect(
      RootPage({ searchParams: Promise.resolve({ __seller: 'bcdfghjkmn' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(
      generateMetadata({
        searchParams: Promise.resolve({ __seller: 'bcdfghjkmn' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('[SLP-004] returns 404 when the tenant host names a different account', async () => {
    state.host = 'other.convoreal.com';
    state.subdomainAccount = 'acct-2';
    await expect(
      RootPage({ searchParams: Promise.resolve({ __seller: 'bcdfghjkmn' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('opens a targeted listing only when it belongs to the seller', async () => {
    state.targetProperty = listing('agency', 'someone-else');
    const foreign = await renderSellerPage({
      __seller: 'bcdfghjkmn',
      property_id: 'agency',
    });
    expect(foreign.props.initialPropertyId).toBeUndefined();
    expect(foreign.props.properties.map((p) => p.id)).not.toContain('agency');

    state.targetProperty = listing('own-1', 'seller-contact');
    const own = await renderSellerPage({
      __seller: 'bcdfghjkmn',
      property_id: 'own-1',
    });
    expect(own.props.initialPropertyId).toBe('own-1');
  });

  it('is excluded from search indexing', async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ __seller: 'bcdfghjkmn' }),
    });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(JSON.stringify(metadata)).toContain('Acme Realty');
  });
});
