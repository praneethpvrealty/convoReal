import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { toPublicListingView } from '@/lib/inventory/showcase-visibility';
import type { GrantedReveals } from '@/lib/inventory/share-grants';
import type { Project, Property, ShowcaseSettings } from '@/types';

export interface ShowcaseData {
  settings: ShowcaseSettings | null;
  /** The Engine's own WhatsApp number (migration 268), so an enquiry
   *  tapped from the catalog lands in the shared inbox rather than on
   *  whichever mobile `contact_phone` happens to hold. Null for an
   *  account on sandbox, or one that has not re-saved its config since
   *  the column landed — both fall back to the old behaviour. */
  engineWhatsAppPhone: string | null;
  /** The brokerage's name, from `accounts.name` — the one place it is
   *  stored. Showcase settings used to carry a second copy of it in
   *  `website_name`, which drifted from this one and split the brand
   *  across client-facing surfaces. */
  accountName: string | null;
  properties: Property[];
  agents: Array<{
    id: string;
    name: string;
    phone: string;
    email: string | null;
  }>;
  profiles: Array<{
    user_id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  }>;
}

export function resolveSubdomainFromHost(host: string): string | null {
  const domainParts = host.split('.');
  if (
    (domainParts.length >= 3 && !host.includes('localhost')) ||
    (host.includes('localhost') &&
      domainParts.length >= 2 &&
      !host.startsWith('localhost'))
  ) {
    const possibleSubdomain = domainParts[0].toLowerCase();
    const systemSubdomains = ['www', 'app', 'admin', 'api'];
    if (!systemSubdomains.includes(possibleSubdomain)) {
      return possibleSubdomain;
    }
  }
  return null;
}

// UUID share links (bot sends, Radar, email digests, share dialogs) must
// resolve regardless of which tenant owns the listing — scoping them to
// NEXT_PUBLIC_DEFAULT_ACCOUNT_ID silently broke every deep link from a
// non-default account. UUIDs are globally unique, so the lookup is safe
// unscoped; the caller re-derives account_id from the row it gets back.
// property_code links stay scoped when a scope is known (codes repeat
// across tenants), falling back to a global lookup only when the code is
// unambiguous.
//
// Memoised per request (React `cache`), not across requests: this is one
// indexed row read, so the only duplication worth removing is
// generateMetadata and the page body asking for the same listing. An
// unstable_cache here served edits — new photos, a price change — from an
// hour-old snapshot to everyone holding the share link.
export const cachedResolvePropertyById = cache(
  async (propertyId: string, scopedAccountId: string | null) => {
    const admin = supabaseAdmin();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        propertyId
      );
    if (isUuid) {
      const { data } = await admin
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .maybeSingle();
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
    const { data: rows } = await admin
      .from('properties')
      .select('*')
      .eq('property_code', code)
      .limit(2);
    return rows && rows.length === 1 ? (rows[0] as Property) : null;
  }
);

export const cachedResolveAccountFromSubdomain = unstable_cache(
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
  { revalidate: 3600 }
);

export const cachedResolveShowcaseRef = unstable_cache(
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

export const cachedFetchFallbackAccount = unstable_cache(
  async () => {
    const admin = supabaseAdmin();
    const { data } = await admin
      .from('accounts')
      .select('id')
      .limit(1)
      .maybeSingle();
    return data?.id || null;
  },
  ['showcase-fallback-account'],
  { revalidate: 3600 }
);

export type PublicProjectInfo = Pick<
  Project,
  'builder' | 'description' | 'amenities' | 'images'
>;

// React `cache`, not `unstable_cache`: a builder edit or a freshly
// uploaded photo must show up on the next request, the same reasoning
// as cachedResolvePropertyById above.
export const cachedFetchProjectBySlug = cache(
  async (
    accountId: string,
    slug: string
  ): Promise<PublicProjectInfo | null> => {
    const admin = supabaseAdmin();
    const { data } = await admin
      .from('projects')
      .select('builder, description, amenities, images')
      .eq('account_id', accountId)
      .eq('slug', slug)
      .maybeSingle();
    return (data as PublicProjectInfo) ?? null;
  }
);

// Cache key ingredient for the showcase catalogue. Every write to a
// listing bumps its updated_at (set_properties_updated_at), and
// publishing, unpublishing, selling or deleting one moves the row count —
// so this pair changes exactly when the public catalogue changes.
//
// The catalogue is written from API routes, cron jobs, the WhatsApp
// webhook, the queue worker and the dashboard's own browser Supabase
// client. Tag-based invalidation would have to be remembered at every one
// of those, and the browser writes cannot call revalidateTag at all;
// deriving the key from the data keeps every path correct instead. One
// aggregate read per render buys the whole catalogue staying fresh.
const showcaseContentVersion = cache(async (accountId: string) => {
  const admin = supabaseAdmin();
  const [propertiesResult, settingsResult, accountResult] = await Promise.all([
    admin
      .from('properties')
      .select('updated_at', { count: 'exact' })
      .eq('account_id', accountId)
      .eq('is_published', true)
      .eq('status', 'Available')
      .order('updated_at', { ascending: false })
      .limit(1),
    admin
      .from('showcase_settings')
      .select('updated_at')
      .eq('account_id', accountId)
      .maybeSingle(),
    admin
      .from('accounts')
      .select('updated_at')
      .eq('id', accountId)
      .maybeSingle(),
  ]);

  return [
    propertiesResult.count ?? -1,
    propertiesResult.data?.[0]?.updated_at ?? '',
    settingsResult.data?.updated_at ?? '',
    accountResult.data?.updated_at ?? '',
  ].join('|');
});

const fetchShowcaseData = async (
  accountId: string,
  isAgentMode: boolean
): Promise<ShowcaseData> => {
  const admin = supabaseAdmin();

  if (isAgentMode) {
    const [settingsResult, accountResult, propertiesResult] = await Promise.all(
      [
        admin
          .from('showcase_settings')
          .select('*')
          .eq('account_id', accountId)
          .maybeSingle(),
        admin.from('accounts').select('name').eq('id', accountId).maybeSingle(),
        admin
          .from('properties')
          .select('*')
          .eq('account_id', accountId)
          .eq('is_published', true)
          .eq('status', 'Available')
          .order('created_at', { ascending: false }),
      ]
    );
    return {
      settings: settingsResult.data || null,
      engineWhatsAppPhone: await engineWhatsAppPhone(admin, accountId),
      accountName: accountResult.data?.name || null,
      properties: propertiesResult.data || [],
      agents: [],
      profiles: [],
    };
  }

  const [
    settingsResult,
    accountResult,
    propertiesResult,
    agentsResult,
    profilesResult,
  ] = await Promise.all([
    admin
      .from('showcase_settings')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle(),
    admin.from('accounts').select('name').eq('id', accountId).maybeSingle(),
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
    admin
      .from('profiles')
      .select('user_id, full_name, email, avatar_url')
      .eq('account_id', accountId),
  ]);

  return {
    settings: settingsResult.data || null,
    engineWhatsAppPhone: await engineWhatsAppPhone(admin, accountId),
    accountName: accountResult.data?.name || null,
    properties: propertiesResult.data || [],
    agents: agentsResult.data || [],
    profiles: profilesResult.data || [],
  };
};

/**
 * The account's connected WhatsApp number, or null.
 *
 * Only `display_phone_number` travels — never the token, the WABA id or
 * the phone_number_id. This value is serialized into the RSC stream of
 * a public page, and a dialable number is the only part of that row a
 * visitor may see. A sandbox account has none, and so keeps the old
 * fallback.
 */
async function engineWhatsAppPhone(
  admin: ReturnType<typeof supabaseAdmin>,
  accountId: string
): Promise<string | null> {
  const { data } = await admin
    .from('whatsapp_config')
    .select('display_phone_number')
    .eq('account_id', accountId)
    .eq('integration_type', 'official_api')
    .eq('status', 'connected')
    .maybeSingle();
  return (data?.display_phone_number as string | null) || null;
}

// The version rides in the cache key rather than the arguments, so a
// catalogue edit lands on a fresh entry immediately; the TTL is only a
// ceiling for the agent/profile rows the version does not cover.
export async function cachedFetchShowcaseData(
  accountId: string,
  isAgentMode: boolean
): Promise<ShowcaseData> {
  const version = await showcaseContentVersion(accountId);
  return unstable_cache(fetchShowcaseData, ['showcase-data', version], {
    revalidate: 3600,
  })(accountId, isAgentMode);
}

// Attach agent details and reduce each row to the public whitelist.
// The full payload is serialized into the RSC stream of every showcase
// page (readable via view-source), so exact location, coordinates and
// Engine internals must never survive this step. Agent mode (mode=view)
// reveals the map only for properties whose location is not guarded;
// a share grant (?g=) reveals the address, pin and documents for the
// single listing it was minted for, guarded or not — see
// src/lib/inventory/location-guard.ts. A teaser-gated listing
// (migration 254) is reduced to its stub here regardless of mode,
// unless that same grant carries reveal_listing — see
// src/lib/inventory/showcase-visibility.ts.
export function toPublicProperties(
  properties: Property[],
  agents: ShowcaseData['agents'],
  profiles: ShowcaseData['profiles'],
  isAgentMode: boolean,
  /** Share grant from ?g=, already resolved and verified against the
   *  property it was minted for. Widens that one listing only — every
   *  other row in the catalog stays masked. */
  grant?: { propertyId: string; reveals: GrantedReveals } | null
): Property[] {
  const userIdToAgentMap: Record<
    string,
    {
      id: string;
      name: string;
      phone: string;
      email?: string | null;
      avatar_url?: string | null;
    }
  > = {};

  profiles.forEach((p) => {
    const matchingContact = agents.find(
      (c) => c.email && c.email.toLowerCase() === p.email?.toLowerCase()
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

  return properties.map((prop) => {
    const agent = prop.user_id ? userIdToAgentMap[prop.user_id] : null;
    const granted =
      grant && grant.propertyId === prop.id ? grant.reveals : undefined;
    return {
      ...toPublicListingView(prop, { revealExact: isAgentMode, granted }),
      agent_details: agent || null,
    };
  });
}
