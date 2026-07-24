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

export const cachedFetchShowcaseData = unstable_cache(
  async (accountId: string, isAgentMode: boolean): Promise<ShowcaseData> => {
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
  },
  ['showcase-data'],
  { revalidate: 3600 }
);

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
