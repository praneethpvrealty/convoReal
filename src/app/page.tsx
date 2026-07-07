import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { ShowcaseView } from '@/components/showcase/showcase-view';
import { MarketingLanding } from '@/components/landing/marketing-landing';
import type { Property, ShowcaseSettings } from '@/types';
import { BRANDING } from '@/config/branding';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';

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
  const heroImage = property.images?.[0]
    ? showcaseImageUrl(property.images[0], SHOWCASE_IMAGE_WIDTHS.hero)
    : null;

  return {
    title: property.title,
    description,
    openGraph: {
      title: property.title,
      description,
      type: 'website',
      ...(heroImage ? { images: [{ url: heroImage }] } : {}),
    },
    robots: { index: true, follow: true },
  };
}

// ── Cached data fetchers ─────────────────────────────────────────
// The page uses runtime APIs (headers, searchParams) so it renders
// dynamically.  ISR `revalidate` has no effect on dynamic pages.
// Instead we cache the expensive Supabase queries with unstable_cache
// so repeat visits with the same parameters are instant.

const cachedResolveAccountFromSubdomain = unstable_cache(
  async (subdomain: string) => {
    const admin = supabaseAdmin();
    const { data } = await admin
      .from('showcase_settings')
      .select('account_id')
      .eq('subdomain', subdomain)
      .maybeSingle();
    return data?.account_id || null;
  },
  ['showcase-subdomain'],
  { revalidate: 3600 },
);

const cachedResolvePropertyById = unstable_cache(
  async (propertyId: string, scopedAccountId: string | null) => {
    const admin = supabaseAdmin();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId);
    let query = admin.from('properties').select('*');
    if (isUuid) query = query.eq('id', propertyId);
    else query = query.eq('property_code', propertyId.toUpperCase());
    if (scopedAccountId) query = query.eq('account_id', scopedAccountId);
    const { data } = await query.maybeSingle();
    return data as Property | null;
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

const cachedFetchFallbackAccount = unstable_cache(
  async () => {
    const admin = supabaseAdmin();
    const { data } = await admin.from('accounts').select('id').limit(1).maybeSingle();
    return data?.id || null;
  },
  ['showcase-fallback-account'],
  { revalidate: 3600 },
);

interface ShowcaseData {
  settings: ShowcaseSettings | null;
  properties: Property[];
  agents: Array<{ id: string; name: string; phone: string; email: string | null }>;
  profiles: Array<{ user_id: string; full_name: string | null; email: string | null; avatar_url: string | null }>;
}

const cachedFetchShowcaseData = unstable_cache(
  async (accountId: string, isAgentMode: boolean): Promise<ShowcaseData> => {
    const admin = supabaseAdmin();

    if (isAgentMode) {
      const [settingsResult, propertiesResult] = await Promise.all([
        admin.from('showcase_settings').select('*').eq('account_id', accountId).maybeSingle(),
        admin
          .from('properties')
          .select('*')
          .eq('account_id', accountId)
          .eq('is_published', true)
          .eq('status', 'Available')
          .order('created_at', { ascending: false }),
      ]);
      return {
        settings: settingsResult.data || null,
        properties: propertiesResult.data || [],
        agents: [],
        profiles: [],
      };
    }

    const [settingsResult, propertiesResult, agentsResult, profilesResult] = await Promise.all([
      admin.from('showcase_settings').select('*').eq('account_id', accountId).maybeSingle(),
      admin
        .from('properties')
        .select('*')
        .eq('account_id', accountId)
        .eq('is_published', true)
        .eq('status', 'Available')
        .order('created_at', { ascending: false }),
      admin
        .from('contacts')
        .select('id, name, phone, email')
        .eq('account_id', accountId)
        .eq('classification', 'Agent'),
      admin.from('profiles').select('user_id, full_name, email, avatar_url').eq('account_id', accountId),
    ]);

    return {
      settings: settingsResult.data || null,
      properties: propertiesResult.data || [],
      agents: agentsResult.data || [],
      profiles: profilesResult.data || [],
    };
  },
  ['showcase-data'],
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

  // Resolve subdomain from hostname
  let subdomain: string | null = null;
  const domainParts = host.split('.');
  if (
    (domainParts.length >= 3 && !host.includes('localhost')) ||
    (host.includes('localhost') && domainParts.length >= 2 && !host.startsWith('localhost'))
  ) {
    const possibleSubdomain = domainParts[0].toLowerCase();
    const systemSubdomains = ['www', 'app', 'admin', 'api'];
    if (!systemSubdomains.includes(possibleSubdomain)) {
      subdomain = possibleSubdomain;
    }
  }

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

  // ── Fast path: Agent mode shares don't need referrer/contacts/profiles ─
  const isAgentMode = resolvedParams.mode === 'agent';

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

  // Build agent mapping
  const userIdToAgentMap: Record<
    string,
    { id: string; name: string; phone: string; email?: string | null; avatar_url?: string | null }
  > = {};

  profiles.forEach((p) => {
    const matchingContact = agentContacts.find(
      (c) => c.email && c.email.toLowerCase() === p.email?.toLowerCase(),
    );
    if (matchingContact) {
      userIdToAgentMap[p.user_id] = {
        id: matchingContact.id,
        name: p.full_name || matchingContact.name,
        phone: matchingContact.phone,
        email: matchingContact.email,
        avatar_url: p.avatar_url,
      };
    }
  });

  // Attach agent details, strip documents
  const propertiesWithAgent = propertiesList.map((prop) => {
    const agent = prop.user_id ? userIdToAgentMap[prop.user_id] : null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { documents: _documents, ...publicProp } = prop;
    return {
      ...publicProp,
      agent_details: agent || null,
    };
  });

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
    />
  );
}
