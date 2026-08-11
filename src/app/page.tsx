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
  cachedResolvePropertyById,
  resolveSubdomainFromHost,
  toPublicProperties,
} from '@/lib/showcase/public-data';
import {
  grantedReveals,
  resolveShareGrant,
  trackGrantView,
} from '@/lib/inventory/share-grants';
import {
  isTeaserGated,
  priceBand,
  teaserTitle,
} from '@/lib/inventory/showcase-visibility';
import { propertySlug } from '@/lib/showcase/property-slug';
import { resolveRequestOrigin } from '@/lib/showcase/site-url';
import { jsonLdScript, propertyJsonLd } from '@/lib/seo/jsonld';
import { BRANDING } from '@/config/branding';

const DEFAULT_METADATA: Metadata = {
  title: `${BRANDING.name} — AI-Powered WhatsApp Deal Engine & Property Portals`,
  description:
    'ConvoReal is a WhatsApp-first, AI-powered real estate CRM and deal engine connecting buyers, property owners, and agents. Auto-capture leads, manage inventories, match properties, and run campaigns.',
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
    /** Share-instance token for generic (recipient-unknown) shares —
     *  labels which share a visit came from in Pulse. Never filters. */
    s?: string;
    /** Share-grant token (migration 198) — unmasks the exact address,
     *  map pin and documents for the one property it was minted for.
     *  Expires and is revocable; verified server-side before it widens
     *  anything. Never filters the catalog. */
    g?: string;
    /** Tenant subdomain label, pinned into the URL by the Cloudflare
     *  Worker that fronts *.convoreal.com (see the wildcard section of
     *  docs/domain-rehosting-guide.md). The Worker re-issues the request
     *  against www, so the Host header no longer carries the label — and
     *  it must ride in the URL rather than a header so the edge cache
     *  keys tenants apart. Spoofing it buys nothing: it resolves the
     *  same public catalogue the subdomain itself would. */
    __tenant?: string;
  }>;
}

/**
 * Property share links get per-property Open Graph tags so WhatsApp
 * (and other messengers) render a rich preview — title, price context,
 * and hero photo — instead of the generic marketing card. The property
 * lookup shares the unstable_cache entry with the page render below,
 * so this costs nothing extra per request.
 */
export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const resolvedParams = await searchParams;
  const propertyId = resolvedParams.property_id;
  if (!propertyId) return DEFAULT_METADATA;

  const accountId = process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID || null;
  const property = await cachedResolvePropertyById(propertyId, accountId);
  if (!property) return DEFAULT_METADATA;

  // Gated without consulting ?g=: this is the unfurl a forwarded link
  // produces, and an unfurl carries no grant.
  if (isTeaserGated(property)) {
    const origin = await resolveRequestOrigin();
    const band = priceBand(property.price);
    return {
      title: teaserTitle(property),
      description: `Confidential listing — details shared on request.${band ? ` Guide price ${band}.` : ''}`,
      alternates: {
        canonical: `${origin}/property/${propertySlug(property)}`,
      },
      openGraph: {
        title: teaserTitle(property),
        description: 'Confidential listing — details shared on request.',
        type: 'website',
      },
      robots: { index: false, follow: false },
    };
  }

  const description =
    (property.description || '').slice(0, 160) ||
    [property.type, property.location].filter(Boolean).join(' · ');

  // Always point the preview image at our own OG route. It renders the
  // listing's first photo (or a branded card when photoless) via next/og,
  // served from this app — so it never depends on the Supabase image-render
  // transform endpoint, which requires a paid add-on and which messenger
  // crawlers (WhatsApp/Telegram) could not fetch, leaving shares imageless.
  const origin = await resolveRequestOrigin();
  const heroImage = `${origin}/api/properties/${property.id}/og-image`;

  // Share links carry per-visitor tracking params (v=, ref=, mode=) that
  // spawn unbounded duplicate URLs — the canonical collapses them all onto
  // the clean crawlable /property/ route.
  const canonicalUrl = `${origin}/property/${propertySlug(property)}`;

  return {
    title: property.title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: property.title,
      description,
      type: 'website',
      url: canonicalUrl,
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

const cachedResolveRef = unstable_cache(
  async (ref: string) => {
    const admin = supabaseAdmin();
    const [accountResult, contactResult, profileResult] = await Promise.all([
      admin.from('accounts').select('id').eq('id', ref).maybeSingle(),
      admin
        .from('contacts')
        .select('account_id, id')
        .eq('id', ref)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('account_id, user_id')
        .eq('user_id', ref)
        .maybeSingle(),
    ]);

    if (accountResult.data) {
      return {
        type: 'account' as const,
        accountId: accountResult.data.id,
        filterContactId: null,
        filterUserId: null,
      };
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
  { revalidate: 3600 }
);

const cachedResolveReferrerPhone = unstable_cache(
  async (
    accountId: string,
    filterContactId: string | null,
    filterUserId: string | null,
    targetPropertyUserId: string | null
  ): Promise<{
    referrerPhone: string | null;
    resolvedContactId: string | null;
  }> => {
    const admin = supabaseAdmin();

    if (filterContactId) {
      const { data: contact } = await admin
        .from('contacts')
        .select('phone')
        .eq('id', filterContactId)
        .maybeSingle();
      return {
        referrerPhone: contact?.phone || null,
        resolvedContactId: filterContactId,
      };
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
  { revalidate: 3600 }
);

// Server Component: fetches public listings & configuration details
export default async function RootPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;

  if (resolvedParams.code) {
    const inviteParam = resolvedParams.invite
      ? `&invite=${encodeURIComponent(resolvedParams.invite)}`
      : '';
    redirect(
      `/auth/callback?code=${encodeURIComponent(resolvedParams.code)}${inviteParam}`
    );
  }

  const reqHeaders = await headers();
  const host = reqHeaders.get('host') || '';
  // Direct visits carry the tenant label in the Host header; visits
  // proxied by the wildcard Worker carry it in ?__tenant= instead.
  // Routing the param through resolveSubdomainFromHost keeps the
  // reserved-label list authoritative for both paths.
  const subdomain =
    resolveSubdomainFromHost(host) ||
    (resolvedParams.__tenant
      ? resolveSubdomainFromHost(
          `${resolvedParams.__tenant.toLowerCase()}.${BRANDING.baseDomain}`
        )
      : null);

  let accountId: string | null =
    process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID || null;
  const ref =
    resolvedParams.ref || resolvedParams.account_id || resolvedParams.agent_id;
  const initialPropertyId = resolvedParams.property_id;

  // If there is no subdomain and no showcase query parameters, serve the product landing page
  if (!subdomain && !ref && !initialPropertyId) {
    return <MarketingLanding />;
  }

  // ── Phase 1: Resolve accountId in parallel ─────────────────────
  // Property lookup + subdomain lookup + ref resolution all fire at once.
  const [subdomainAccount, targetProperty] = await Promise.all([
    subdomain
      ? cachedResolveAccountFromSubdomain(subdomain)
      : Promise.resolve(null),
    initialPropertyId
      ? cachedResolvePropertyById(initialPropertyId, accountId)
      : Promise.resolve(null),
  ]);

  if (subdomainAccount) accountId = subdomainAccount;
  if (targetProperty) accountId = targetProperty.account_id;

  // ── Fast path: clean-view shares don't need referrer/contacts/profiles ─
  // 'view' is the public value ('agent' kept for previously shared links —
  // it read as an internal role name to buyers, so links now say mode=view).
  const isAgentMode =
    resolvedParams.mode === 'view' || resolvedParams.mode === 'agent';

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
      <div className="flex h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="max-w-md space-y-3 text-center">
          <h2 className="text-xl font-bold">Showcase Setup Pending</h2>
          <p className="text-sm text-slate-400">
            Please log in to the admin dashboard and configure your account
            settings.
          </p>
          <a
            href="/login"
            className="bg-primary text-primary-foreground hover:bg-primary-hover inline-block rounded-lg px-4 py-2 text-xs font-bold"
          >
            Go to Login Portal
          </a>
        </div>
      </div>
    );
  }

  // ── Phase 2: Fetch showcase data (cached) ────────────────────
  const {
    settings,
    accountName,
    properties: publishedProperties,
    agents: agentContacts,
    profiles,
  } = await cachedFetchShowcaseData(accountId, isAgentMode);

  let filteredProperties = [...publishedProperties];

  // Apply referrer filter client-side
  if (filterContactId) {
    filteredProperties = filteredProperties.filter(
      (p) => p.owner_contact_id === filterContactId
    );
  } else if (filterUserId) {
    filteredProperties = filteredProperties.filter(
      (p) => p.user_id === filterUserId
    );
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
      targetProperty?.user_id || null
    );
    referrerPhone = referrerResult.referrerPhone;
    if (referrerResult.resolvedContactId) {
      filterContactId = referrerResult.resolvedContactId;
    }
  }

  // ── Share grant (?g=) ───────────────────────────────────────────
  // Resolved against the property the link opens, so a token lifted
  // from one share cannot widen a different listing. Uncached on
  // purpose: revoking a grant has to take effect on the next open, not
  // an hour later.
  const shareGrant =
    resolvedParams.g && targetProperty
      ? await resolveShareGrant(
          supabaseAdmin(),
          resolvedParams.g,
          targetProperty.id,
          accountId
        )
      : null;

  if (shareGrant) {
    await trackGrantView(supabaseAdmin(), shareGrant);
  }

  const propertiesWithAgent = toPublicProperties(
    propertiesList,
    agentContacts,
    profiles,
    isAgentMode,
    shareGrant
      ? {
          propertyId: shareGrant.property_id,
          reveals: grantedReveals(shareGrant),
        }
      : null
  );

  const proto = reqHeaders.get('x-forwarded-proto') || 'https';
  const origin = host
    ? `${proto}://${host}`
    : (process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl).replace(
        /\/$/,
        ''
      );

  // Render
  return (
    <>
      {targetProperty && !isTeaserGated(targetProperty) && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              propertyJsonLd(
                targetProperty,
                `${origin}/property/${propertySlug(targetProperty)}`,
                `${origin}/api/properties/${targetProperty.id}/og-image`
              )
            ),
          }}
        />
      )}
      <ShowcaseView
        properties={propertiesWithAgent}
        settings={settings}
        accountId={accountId}
        siteName={accountName}
        referrerContactId={filterContactId || undefined}
        referrerPhone={referrerPhone || undefined}
        initialPropertyId={initialPropertyId}
        initialCategory={resolvedParams.category}
        initialAgentMode={isAgentMode}
        visitorRef={resolvedParams.v}
        shareId={resolvedParams.s}
        shareGrantToken={shareGrant?.token}
      />
    </>
  );
}
