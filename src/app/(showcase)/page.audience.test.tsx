import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const state = vi.hoisted(() => ({
  targetProperty: null as Record<string, unknown> | null,
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (key: string) => (key === 'host' ? 'www.convoreal.com' : null),
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

vi.mock('@/lib/supabase/admin', () => {
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'eq', 'in', 'order', 'limit']) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => ({ data: null, error: null });
  return { supabaseAdmin: () => builder };
});

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

const listing = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  account_id: 'acct-1',
  user_id: null,
  title: `Listing ${id}`,
  type: 'Apartment',
  is_published: true,
  status: 'Available',
  price: 100,
  images: [],
  ...extra,
});

const buyersOnly = listing('quiet', { showcase_audience: 'buyers_only' });

vi.mock('@/lib/showcase/public-data', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/showcase/public-data')>();
  return {
    resolveSubdomainFromHost: actual.resolveSubdomainFromHost,
    cachedResolveSellerPage: async () => null,
    cachedResolveAccountFromSubdomain: async () => null,
    cachedResolvePropertyById: async () => state.targetProperty,
    cachedResolveShowcaseRef: async (ref: string) =>
      ref === 'acct-1'
        ? {
            type: 'account' as const,
            accountId: 'acct-1',
            filterContactId: null,
            filterUserId: null,
          }
        : null,
    cachedResolveVisitorIsAgent: async (_accountId: string, v: string) =>
      v === 'cobroker-contact',
    cachedFetchFallbackAccount: async () => 'acct-1',
    cachedFetchShowcaseData: async (
      _accountId: string,
      agentMode: boolean
    ) => ({
      settings: null,
      accountName: 'Acme Realty',
      engineWhatsAppPhone: null,
      properties: agentMode
        ? [listing('open'), listing('all', { showcase_audience: 'all' })]
        : [
            listing('open'),
            buyersOnly,
            listing('all', { showcase_audience: 'all' }),
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

async function render(params: Record<string, string>) {
  const tree = await RootPage({ searchParams: Promise.resolve(params) });
  const view = findShowcaseView(tree);
  expect(view).not.toBeNull();
  return {
    tree,
    props: view!.props as {
      properties: Array<{ id: string }>;
      initialPropertyId?: string;
      initialAgentMode?: boolean;
      agentAudience?: boolean;
    },
  };
}

beforeEach(() => {
  state.targetProperty = null;
});

describe('showcase audience', () => {
  it('[PRP-046] a buyer sees every listing, buyers-only included', async () => {
    const { props } = await render({ ref: 'acct-1' });
    expect(props.properties.map((p) => p.id)).toEqual(['open', 'quiet', 'all']);
    expect(props.initialAgentMode).toBe(false);
    expect(props.agentAudience).toBe(false);
  });

  it('[PRP-046] the co-broker view never receives a buyers-only row', async () => {
    const { props, tree } = await render({ ref: 'acct-1', mode: 'view' });
    expect(props.properties.map((p) => p.id)).toEqual(['open', 'all']);
    expect(props.initialAgentMode).toBe(true);
    expect(props.agentAudience).toBe(true);
    expect(JSON.stringify(tree)).not.toContain('quiet');
  });

  it('[PRP-046] a visitor the link names as an Agent contact is treated as the co-broker view', async () => {
    const { props, tree } = await render({
      ref: 'acct-1',
      v: 'cobroker-contact',
    });
    expect(props.properties.map((p) => p.id)).toEqual(['open', 'all']);
    expect(props.initialAgentMode).toBe(false);
    expect(props.agentAudience).toBe(true);
    expect(JSON.stringify(tree)).not.toContain('quiet');
  });

  it('[PRP-046] a buyer visitor named by the link keeps the full catalogue', async () => {
    const { props } = await render({ ref: 'acct-1', v: 'buyer-contact' });
    expect(props.properties.map((p) => p.id)).toEqual(['open', 'quiet', 'all']);
  });

  it('[PRP-046] a mode=view deep link to a buyers-only listing opens the grid without it', async () => {
    state.targetProperty = buyersOnly;
    const { props, tree } = await render({
      property_id: 'quiet',
      mode: 'view',
    });
    expect(props.initialPropertyId).toBeUndefined();
    expect(props.properties.map((p) => p.id)).toEqual(['open', 'all']);
    expect(JSON.stringify(tree)).not.toContain('Listing quiet');
  });

  it('[PRP-046] the same deep link opens the listing for a buyer', async () => {
    state.targetProperty = buyersOnly;
    const { props } = await render({ property_id: 'quiet' });
    expect(props.initialPropertyId).toBe('quiet');
    expect(props.properties.map((p) => p.id)).toContain('quiet');
  });

  it('[PRP-046] a mode=view link to a buyers-only listing unfurls as the agency, not the listing', async () => {
    state.targetProperty = buyersOnly;
    const hidden = await generateMetadata({
      searchParams: Promise.resolve({ property_id: 'quiet', mode: 'view' }),
    });
    expect(JSON.stringify(hidden)).not.toContain('Listing quiet');
    const shown = await generateMetadata({
      searchParams: Promise.resolve({ property_id: 'quiet' }),
    });
    expect(JSON.stringify(shown)).toContain('Listing quiet');
  });
});
