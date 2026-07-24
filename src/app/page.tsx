import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { ShowcaseView } from '@/components/showcase/showcase-view';
import { MarketingLanding } from '@/components/landing/marketing-landing';
import {
  cachedFetchFallbackAccount,
  cachedFetchShowcaseData,
  cachedResolveAccountFromSubdomain,
  resolveSubdomainFromHost,
  toPublicProperties,
} from '@/lib/showcase/public-data';
import type { Property } from '@/types';
import { BRANDING } from '@/config/branding';

const DEFAULT_METADATA: Metadata = {
  title: `${BRANDING.name} — AI-Powered WhatsApp CRM & Property Portals`,
  description:
    'ConvoReal is a premium WhatsApp-first, AI-based real estate platform connecting buyers, property owners, and agents. Auto-capture leads, manage inventories, match properties, and run campaigns.',
  robots: {
    index: true,
    follow: true,
  },
};

interface PageProps {
  searchParams: Promise<{
    account_id?: string;
    ref?: string;
    agent_id?: string;
    property_id?: string;
    category?: string;
    code?: string;
    invite?: string;
    mode?: string;
    /** Visitor identity for Showcase Pulse tracking (per-contact share
     *  links append v=<contact_id>). Unlike ref=, it never filters the
     *  catalog — it only attributes engagement events. */
    v?: string;
  }>;
}

/**
 * Property share links get per-property Open Graph tags so WhatsApp
 * (and other messengers) render a rich preview — title, price context,
 * and hero photo — instead of the generic marketing card. The property
 * lookup shares the unstable_cache entry with the page render below,
 * so this costs nothing extra per request.
 */
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const resolvedParams = await searchParams;
  const propertyId = resolvedParams.property_id;
  if (!propertyId) return DEFAULT_METADATA;

  const accountId = process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID || null;
  const property = await cachedResolvePropertyById(propertyId, accountId);
  if (!property) return DEFAULT_METADATA;

  const description =
    (property.description || '').slice(0, 160) ||
    [property.type, property.location].filter(Boolean).join(' · ');

  // Always point the preview image at our own OG route. It renders the
  // listing's first photo (or a branded card when photoless) via next/og,
  // served from this app — so it never depends on the Supabase image-render
  // transform endpoint, which requires a paid add-on and which messenger
  // crawlers (WhatsApp/Telegram) could not fetch, leaving shares imageless.
  const h = await headers();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  const origin = host
    ? `${proto}://${host}`
    : (process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl).replace(/\/$/, '');
  const heroImage = `${origin}/api/properties/${property.id}/og-image`;

  return {
    title: property.title,
    description,
    openGraph: {
      title: property.title,
      description,
      type: 'website',
      images: [{ url: heroImage }],
    },
    twitter: {
      card: 'summary_large_image',
      title: property.title,
      description,
      images: [heroImage],
    },
    robots: { index: true, follow: true },
  };
}

// ── Cached data fetchers ─────────────────────────────────────────
// The page uses runtime APIs (headers, searchParams) so it renders
// dynamically.  ISR `revalidate` has no effect on dynamic pages.
// Instead we cache the expensive Supabase queries with unstable_cache
// so repeat visits with the same parameters are instant.

// UUID share links (bot sends, Radar, email digests, share dialogs) must
// resolve regardless of which tenant owns the listing — scoping them to
// NEXT_PUBLIC_DEFAULT_ACCOUNT_ID silently broke every deep link from a
// non-default account. UUIDs are globally unique, so the lookup is safe
// unscoped; the caller re-derives account_id from the row it gets back.
// property_code links stay scoped when a scope is known (codes repeat
// across tenants), falling back to a global lookup only when the code is
// unambiguous.
const cachedResolvePropertyById = unstable_cache(
  async (propertyId: string, scopedAccountId: string | null) => {
    const admin = supabaseAdmin();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId);
    if (isUuid) {
      const { data } = await admin.from('properties').select('*').eq('id', propertyId).maybeSingle();
      return data as Property | null;
    }
    const code = propertyId.toUpperCase();
    if (scopedAccountId) {
      const { data } = await admin
        .from('properties')
        .select('*')
        .eq('property_code', code)
        .eq('account_id', scopedAccountId)
        .maybeSingle();
      if (data) return data as Property;
    }
    const { data: rows } = await admin.from('properties').select('*').eq('property_code', code).limit(2);
    return rows && rows.length === 1 ? (rows[0] as Property) : null;
  },
  ['showcase-property'],
  { revalidate: 3600 },
);

const cachedResolveRef = unstable_cache(
  async (ref: string) => {
    const admin = supabaseAdmin();
    const [accountResult, contactResult, profileResult] = await Promise.all([
      admin.from('accounts').select('id').eq('id', ref).maybeSingle(),
      admin.from('contacts').select('account_id, id').eq('id', ref).maybeSingle(),
      admin.from('profiles').select('account_id, user_id').eq('user_id', ref).maybeSingle(),
    ]);

    if (accountResult.data) {
      return { type: 'account' as const, accountId: accountResult.data.id, filterContactId: null, filterUserId: null };
    }
    if (contactResult.data) {
      return {
        type: 'contact' as const,
        accountId: contactResult.data.account_id,
        filterContactId: contactResult.data.id,
        filterUserId: null,
      };
    }
    if (profileResult.data) {
      return {
        type: 'profile' as const,
        accountId: profileResult.data.account_id,
        filterContactId: null,
        filterUserId: profileResult.data.user_id,
      };
    }
    return null;
  },
  ['showcase-ref'],
  { revalidate: 3600 },
);

const cachedResolveReferrerPhone = unstable_cache(
  async (
    accountId: string,
    filterContactId: string | null,
    filterUserId: string | null,
    targetPropertyUserId: string | null,
  ): Promise<{ referrerPhone: string | null; resolvedContactId: string | null }> => {
    const admin = supabaseAdmin();

    if (filterContactId) {
      const { data: contact } = await admin
        .from('contacts')
        .select('phone')
        .eq('id', filterContactId)
        .maybeSingle();
      return { referrerPhone: contact?.phone || null, resolvedContactId: filterContactId };
    }

    if (filterUserId) {
      const { data: profile } = await admin
        .from('profiles')
        .select('email')
        .eq('user_id', filterUserId)
        .maybeSingle();
      if (profile?.email) {
        const { data: contact } = await admin
          .from('contacts')
          .select('phone, id')
          .eq('account_id', accountId)
          .eq('email', profile.email)
          .maybeSingle();
        return {
          referrerPhone: contact?.phone || null,
          resolvedContactId: contact?.id || null,
        };
      }
    }

    if (targetPropertyUserId) {
      const { data: profile } = await admin
        .from('profiles')
        .select('email')
        .eq('user_id', targetPropertyUserId)
        .maybeSingle();
      if (profile?.email) {
        const { data: contact } = await admin
          .from('contacts')
          .select('phone, id')
          .eq('account_id', accountId)
          .eq('email', profile.email)
          .maybeSingle();
        return {
          referrerPhone: contact?.phone || null,
          resolvedContactId: contact?.id || null,
        };
      }
    }

    return { referrerPhone: null, resolvedContactId: null };
  },
  ['showcase-referrer'],
  { revalidate: 3600 },
);

// Server Component: fetches public listings & configuration details
export default async function RootPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;

  if (resolvedParams.code) {
    const inviteParam = resolvedParams.invite
      ? `&invite=${encodeURIComponent(resolvedParams.invite)}`
      : '';
    redirect(`/auth/callback?code=${encodeURIComponent(resolvedParams.code)}${inviteParam}`);
  }

  const reqHeaders = await headers();
  const host = reqHeaders.get('host') || '';
  const subdomain = resolveSubdomainFromHost(host);

  let accountId: string | null = process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID || null;
  const ref = resolvedParams.ref || resolvedParams.account_id || resolvedParams.agent_id;
  const initialPropertyId = resolvedParams.property_id;

  // If there is no subdomain and no showcase query parameters, serve the product landing page
  if (!subdomain && !ref && !initialPropertyId) {
    return <MarketingLanding />;
  }

  // ── Phase 1: Resolve accountId in parallel ─────────────────────
  // Property lookup + subdomain lookup + ref resolution all fire at once.
  const [subdomainAccount, targetProperty] = await Promise.all([
    subdomain ? cachedResolveAccountFromSubdomain(subdomain) : Promise.resolve(null),
    initialPropertyId ? cachedResolvePropertyById(initialPropertyId, accountId) : Promise.resolve(null),
  ]);

  if (subdomainAccount) accountId = subdomainAccount;
  if (targetProperty) accountId = targetProperty.account_id;

  // ── Fast path: clean-view shares don't need referrer/contacts/profiles ─
  // 'view' is the public value ('agent' kept for previously shared links —
  // it read as an internal role name to buyers, so links now say mode=view).
  const isAgentMode = resolvedParams.mode === 'view' || resolvedParams.mode === 'agent';

  let filterContactId: string | null = null;
  let filterUserId: string | null = null;

  if (!isAgentMode && ref) {
    const resolved = await cachedResolveRef(ref);
    if (resolved) {
      if (!accountId) accountId = resolved.accountId;
      if (accountId === resolved.accountId) {
        filterContactId = resolved.filterContactId;
        filterUserId = resolved.filterUserId;
      }
    }
  }

  // Fallback to default account
  if (!accountId) {
    accountId = await cachedFetchFallbackAccount();
  }

  if (!accountId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white p-6">
        <div className="max-w-md text-center space-y-3">
          <h2 className="text-xl font-bold">Showcase Setup Pending</h2>
          <p className="text-sm text-slate-400">
            Please log in to the admin dashboard and configure your account settings.
          </p>
          <a
            href="/login"
            className="inline-block bg-primary text-primary-foreground font-bold px-4 py-2 rounded-lg text-xs hover:bg-primary-hover"
          >
            Go to Login Portal
          </a>
        </div>
      </div>
    );
  }

  // ── Phase 2: Fetch showcase data (cached) ────────────────────
  const { settings, properties: publishedProperties, agents: agentContacts, profiles } =
    await cachedFetchShowcaseData(accountId, isAgentMode);

  let filteredProperties = [...publishedProperties];

  // Apply referrer filter client-side
  if (filterContactId) {
    filteredProperties = filteredProperties.filter((p) => p.owner_contact_id === filterContactId);
  } else if (filterUserId) {
    filteredProperties = filteredProperties.filter((p) => p.user_id === filterUserId);
  }

  // Merge targeted property if not in list
  const propertiesList = [...filteredProperties];
  if (targetProperty) {
    const exists = propertiesList.some((p) => p.id === targetProperty.id);
    if (!exists) {
      propertiesList.unshift(targetProperty);
    }
  }

  // ── Phase 3: Resolve referrer phone (cached, skip in agent mode) ──
  let referrerPhone: string | null = null;

  if (!isAgentMode) {
    const referrerResult = await cachedResolveReferrerPhone(
      accountId,
      filterContactId,
      filterUserId,
      targetProperty?.user_id || null,
    );
    referrerPhone = referrerResult.referrerPhone;
    if (referrerResult.resolvedContactId) {
      filterContactId = referrerResult.resolvedContactId;
    }
  }

  const propertiesWithAgent = toPublicProperties(propertiesList, agentContacts, profiles, isAgentMode);

  // Render
  return (
    <ShowcaseView
      properties={propertiesWithAgent}
      settings={settings}
      accountId={accountId}
      referrerContactId={filterContactId || undefined}
      referrerPhone={referrerPhone || undefined}
      initialPropertyId={initialPropertyId}
      initialCategory={resolvedParams.category}
      initialAgentMode={isAgentMode}
      visitorRef={resolvedParams.v}
    />
  );
}
