// Port of the web contacts page's getPrefilledWhatsAppLink — the
// "Send pre-filled welcome message on WhatsApp" button. Greets the
// lead by name, asks the qualification questions, and links the
// account's showcase: personalized to the last-inquired property when
// there is one, else filtered by the contact's interests. Keep the
// message text in sync with contacts-content.tsx / contact-detail-view.

import * as Linking from 'expo-linking';

import { useAuthStore } from '@/lib/auth-store';
import { ENV } from '@/lib/env';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import type { Contact, Property } from '@/lib/types';

interface WelcomeLinkInput {
  contact: Contact;
  propDetails: Property | null;
  agentName: string;
  accountId: string | null;
  subdomain: string | null;
}

/** Same host math as the web: the showcase lives on the account's
 *  subdomain of the app's base domain when one is configured. */
function showcaseBase(subdomain: string | null, accountId: string | null): URL {
  const api = new URL(ENV.apiBaseUrl);
  const parts = api.host.split('.');
  let hostDomain = api.host;
  if (parts.length > 2 && !api.host.includes('localhost') && !/^\d+\.\d+\.\d+\.\d+$/.test(api.hostname)) {
    hostDomain = parts.slice(1).join('.');
  }
  const target = subdomain ? `${subdomain}.${hostDomain}` : api.host;
  const url = new URL(`${api.protocol}//${target}`);
  if (!subdomain && accountId) {
    url.searchParams.set('ref', accountId);
  }
  return url;
}

export function buildWelcomeLink({
  contact,
  propDetails,
  agentName,
  accountId,
  subdomain,
}: WelcomeLinkInput): string {
  const cleanPhone = contact.phone.replace(/\D/g, '');
  if (!cleanPhone) return '';

  const displayName = contact.name || 'there';
  const showcaseUrlObj = showcaseBase(subdomain, accountId);
  const finalShowcaseUrl = showcaseUrlObj.toString();

  let linkSection = '';
  if (propDetails) {
    const singlePropUrl = new URL(showcaseUrlObj.toString());
    singlePropUrl.searchParams.set('property_id', propDetails.property_code || propDetails.id);

    const matchingUrl = new URL(showcaseUrlObj.toString());
    if (propDetails.listing_type) {
      matchingUrl.searchParams.set('listing_type', propDetails.listing_type);
    }
    if (propDetails.type) {
      matchingUrl.searchParams.set('category', propDetails.type);
    }
    const searchLocation = propDetails.sublocality || propDetails.city || '';
    if (searchLocation) {
      matchingUrl.searchParams.set('search', searchLocation);
    }

    linkSection = `Meanwhile, you can view details for the property you enquired about here:
${singlePropUrl.toString()}

Or browse other matching verified properties here:
${matchingUrl.toString()}`;
  } else {
    const hasInterestFilters =
      (contact.areas_of_interest && contact.areas_of_interest.length > 0) ||
      (contact.property_interests && contact.property_interests.length > 0);

    if (hasInterestFilters) {
      const matchingUrl = new URL(showcaseUrlObj.toString());
      if (contact.areas_of_interest && contact.areas_of_interest.length > 0) {
        matchingUrl.searchParams.set('search', contact.areas_of_interest[0]);
      }
      if (contact.property_interests && contact.property_interests.length > 0) {
        matchingUrl.searchParams.set('category', contact.property_interests[0]);
      }

      const filterDesc = [
        contact.property_interests?.[0],
        contact.areas_of_interest?.[0] ? `in ${contact.areas_of_interest[0]}` : '',
      ]
        .filter(Boolean)
        .join(' ');

      linkSection = `Meanwhile, you can browse verified ${filterDesc || 'matching'} properties here:
${matchingUrl.toString()}`;
    } else {
      linkSection = `Meanwhile, you can browse 500+ verified properties matching different budgets here:
${finalShowcaseUrl}`;
    }
  }

  const consultant = agentName
    ? `I'm ${agentName}, your real estate consultant.`
    : `I'm your real estate consultant.`;

  const message = `Hi ${displayName} 👋
Thank you for your property enquiry. ${consultant}

To help me suggest the best options, could you please share:
• Preferred location
• Budget
• Flat/Plot/Villa
• Ready-to-move or under-construction

${linkSection}

Once you share your requirements, I'll personally shortlist the best 5–10 properties for you.`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

async function fetchShowcaseSettings(
  accountId: string | null
): Promise<{ subdomain: string | null } | null> {
  if (!accountId) return null;
  return queryClient.fetchQuery({
    queryKey: ['showcase-settings', accountId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('showcase_settings')
        .select('subdomain')
        .eq('account_id', accountId)
        .maybeSingle();
      return (data ?? null) as { subdomain: string | null } | null;
    },
  });
}

/** The account's public showcase URL (subdomain-aware, ref fallback) —
 *  what the web's showcase share dialog links to. */
export async function getShowcaseUrl(): Promise<string> {
  const accountId = useAuthStore.getState().profile?.account_id ?? null;
  const settings = await fetchShowcaseSettings(accountId);
  return showcaseBase(settings?.subdomain ?? null, accountId).toString();
}

/**
 * The full desktop flow: load showcase settings (cached) and the
 * last-inquired property, then open WhatsApp with the drafted message.
 */
export async function openWelcomeWhatsApp(contact: Contact): Promise<void> {
  const profile = useAuthStore.getState().profile;
  const accountId = profile?.account_id ?? null;
  const settings = await fetchShowcaseSettings(accountId);

  let propDetails: Property | null = null;
  if (contact.last_inquired_property_id) {
    const { data } = await supabase
      .from('properties')
      .select('id, property_code, listing_type, type, sublocality, city')
      .eq('id', contact.last_inquired_property_id)
      .maybeSingle();
    propDetails = (data ?? null) as Property | null;
  }

  const link = buildWelcomeLink({
    contact,
    propDetails,
    agentName: profile?.full_name?.trim() ?? '',
    accountId,
    subdomain: settings?.subdomain ?? null,
  });
  if (link) await Linking.openURL(link);
}
