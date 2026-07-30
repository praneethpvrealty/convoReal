import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import type { Property, ShowcaseSettings } from '@/types';

export interface ShowcaseData {
  settings: ShowcaseSettings | null;
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
  const [propertiesResult, settingsResult] = await Promise.all([
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
  ]);

  return [
    propertiesResult.count ?? -1,
    propertiesResult.data?.[0]?.updated_at ?? '',
    settingsResult.data?.updated_at ?? '',
  ].join('|');
});

const fetchShowcaseData = async (
  accountId: string,
  isAgentMode: boolean
): Promise<ShowcaseData> => {
  const admin = supabaseAdmin();

  if (isAgentMode) {
    const [settingsResult, propertiesResult] = await Promise.all([
      admin
        .from('showcase_settings')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle(),
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

  const [settingsResult, propertiesResult, agentsResult, profilesResult] =
    await Promise.all([
      admin
        .from('showcase_settings')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle(),
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
    properties: propertiesResult.data || [],
    agents: agentsResult.data || [],
    profiles: profilesResult.data || [],
  };
};

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

// Attach agent details, strip documents. In buyer mode the UI promises
// "street address & map pin hidden until inquiry" — so the pin must be
// kept out of the serialized payload too (it's readable via view-source),
// not just left unrendered. Agent mode (mode=view) keeps it for the map.
export function toPublicProperties(
  properties: Property[],
  agents: ShowcaseData['agents'],
  profiles: ShowcaseData['profiles'],
  isAgentMode: boolean
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { documents: _documents, google_map_link, ...publicProp } = prop;
    return {
      ...publicProp,
      google_map_link: isAgentMode ? google_map_link : null,
      agent_details: agent || null,
    };
  });
}
