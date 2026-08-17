// ============================================================
// Buyer match reply — the on-demand half of "matches on WhatsApp".
//
// A buyer who texts "MATCHES" gets them back immediately, ranked by
// the same engine as the digest and the portal. Free-form by
// definition: they just opened the 24-hour window by messaging, so no
// template is involved and nothing needs approving first.
//
// Best-effort: returns null when there is nothing to say, and the
// webhook falls through to its normal handling.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property } from '@/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BRANDING } from '@/config/branding';
import {
  curateForBuyer,
  hasBuyerBrief,
  type CuratedMatch,
} from './matches-ranking';
import {
  buildMatchDigestMessage,
  buildNoMatchesMessage,
  buildUnavailableEnquiryMessage,
  MAX_DIGEST_MATCHES,
} from './digest';

const POOL_LIMIT = 300;

const ENQUIRY_REASON = 'Property you enquired about';

function pinEnquiredProperty(
  matches: CuratedMatch[],
  property: Property
): CuratedMatch[] {
  const existing = matches.find((match) => match.property.id === property.id);
  const pinned: CuratedMatch = existing
    ? {
        ...existing,
        reasons: [
          ENQUIRY_REASON,
          ...existing.reasons.filter((reason) => reason !== ENQUIRY_REASON),
        ],
      }
    : {
        property,
        score: 100,
        details: {
          type: 'unknown',
          location: 'unknown',
          budget: 'unknown',
          bhk: 'unknown',
          roi: 'unknown',
        },
        reasons: [ENQUIRY_REASON],
      };

  return [
    pinned,
    ...matches.filter((match) => match.property.id !== property.id),
  ].slice(0, MAX_DIGEST_MATCHES);
}

function portalUrl(): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl
  ).replace(/\/$/, '');
  return `${base}/buyer/login?next=/buyer/matches`;
}

/**
 * Builds the reply to an on-demand match request. Unlike the digest
 * this does NOT suppress previously-sent listings — the buyer asked
 * right now, and showing them "nothing" because we mentioned those
 * same listings last week would be absurd.
 */
export async function buildBuyerMatchReply(args: {
  accountId: string;
  contactId: string;
  db?: SupabaseClient;
}): Promise<string | null> {
  const db = args.db || supabaseAdmin();
  try {
    const { data: contactRow } = await db
      .from('contacts')
      .select('*')
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
      .maybeSingle();
    const contact = contactRow as Contact | null;
    if (!contact) return null;
    const hasBrief = hasBuyerBrief(contact);
    if (!hasBrief && !contact.last_inquired_property_id) return null;

    let unavailableEnquiryTitle: string | null = null;
    let availableEnquiry: Property | null = null;
    if (contact.last_inquired_property_id) {
      const { data: enquired } = await db
        .from('properties')
        .select('*')
        .eq('id', contact.last_inquired_property_id)
        .eq('account_id', args.accountId)
        .maybeSingle();
      if (enquired) {
        if (enquired.status === 'Available' && enquired.is_published === true) {
          availableEnquiry = enquired as Property;
        } else {
          unavailableEnquiryTitle = enquired.title;
        }
      }
    }

    const { data: poolRows } = await db
      .from('properties')
      .select('*')
      .eq('account_id', args.accountId)
      .eq('is_published', true)
      .eq('status', 'Available')
      .order('created_at', { ascending: false })
      .limit(POOL_LIMIT);

    const rankedMatches = hasBrief
      ? curateForBuyer((poolRows || []) as Property[], contact, {
          limit: MAX_DIGEST_MATCHES,
        })
      : [];
    const matches = availableEnquiry
      ? pinEnquiredProperty(rankedMatches, availableEnquiry)
      : rankedMatches;
    if (matches.length === 0) {
      return unavailableEnquiryTitle
        ? buildUnavailableEnquiryMessage({
            contactName: contact.name,
            propertyTitle: unavailableEnquiryTitle,
            hasAlternatives: false,
          })
        : buildNoMatchesMessage(contact.name);
    }

    const digest = buildMatchDigestMessage({
      contactName: contact.name,
      matches,
      portalUrl: portalUrl(),
      enquiredPropertyId: availableEnquiry?.id,
    });
    return unavailableEnquiryTitle
      ? `${buildUnavailableEnquiryMessage({
          contactName: contact.name,
          propertyTitle: unavailableEnquiryTitle,
          hasAlternatives: true,
        })}\n\n${digest}`
      : digest;
  } catch (err) {
    console.error('[buyer-match-reply] failed:', err);
    return null;
  }
}
