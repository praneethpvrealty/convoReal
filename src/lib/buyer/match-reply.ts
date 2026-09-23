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
import { accountPropertiesShowcaseUrl } from '@/lib/showcase/account-showcase-url';
import {
  curateForBuyer,
  hasBuyerBrief,
  type CuratedMatch,
} from './matches-ranking';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import { areaNearMissLine } from './area-near-misses';
import {
  buildWidenSearchQuestion,
  describeBrief,
  nextQualifierForContact,
  prefsFromContact,
} from '@/lib/ai/buyer-qualification';
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

async function noMatchesFollowUp(
  db: SupabaseClient,
  accountId: string,
  contact: Contact
): Promise<{
  brief: string;
  question: string | null;
  nearMiss: string | null;
}> {
  const prefs = prefsFromContact(contact);
  const missing = nextQualifierForContact(contact, { defaultBuying: true });
  return {
    brief: describeBrief(prefs),
    question: missing ? buildWidenSearchQuestion(missing) : null,
    nearMiss: await areaNearMissLine({
      db,
      accountId,
      contactId: contact.id,
      brief: {
        areas: prefs.areas,
        listingTypes: prefs.listing_types,
        budgetMin: prefs.budget_min,
        budgetMax: prefs.budget_max,
      },
    }),
  };
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
  const reply = await buildBuyerMatchReplyWithListings(args);
  return reply?.text ?? null;
}

/**
 * The reply and the listings it names, for the sender to record in the
 * share ledger. Without that record the qualification reply, which does
 * suppress previously-sent listings, has no way of knowing the buyer
 * was shown these minutes ago and sends them again.
 */
export async function buildBuyerMatchReplyWithListings(args: {
  accountId: string;
  contactId: string;
  db?: SupabaseClient;
}): Promise<{ text: string; propertyIds: string[] } | null> {
  const db = args.db || supabaseAdmin();
  try {
    const { data: contactRow } = await db
      .from('contacts')
      .select('*')
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
      .maybeSingle();
    const [contact] = await attachInquiredListingTypes(
      db,
      args.accountId,
      contactRow ? [contactRow as Contact] : []
    );
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
      return {
        text: unavailableEnquiryTitle
          ? buildUnavailableEnquiryMessage({
              contactName: contact.name,
              propertyTitle: unavailableEnquiryTitle,
              hasAlternatives: false,
            })
          : buildNoMatchesMessage(
              contact.name,
              await noMatchesFollowUp(db, args.accountId, contact)
            ),
        propertyIds: [],
      };
    }

    const showcaseUrl = await accountPropertiesShowcaseUrl(
      db,
      args.accountId,
      matches.map((match) => match.property),
      contact.id
    );
    const digest = buildMatchDigestMessage({
      contactName: contact.name,
      matches,
      portalUrl: showcaseUrl,
      enquiredPropertyId: availableEnquiry?.id,
    });
    return {
      text: unavailableEnquiryTitle
        ? `${buildUnavailableEnquiryMessage({
            contactName: contact.name,
            propertyTitle: unavailableEnquiryTitle,
            hasAlternatives: true,
          })}\n\n${digest}`
        : digest,
      propertyIds: matches.map((match) => match.property.id),
    };
  } catch (err) {
    console.error('[buyer-match-reply] failed:', err);
    return null;
  }
}
