import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

// GET /api/portals/unmapped-ads
//
// The portal ads that have leads waiting and no property_portal_listings
// row yet — the queue of first assertions. One row per ad, not per lead:
// an ad with nine enquiries is one decision.
//
// Every ad here is a mapping the Engine cannot make for the agent. Until
// it exists the lead webhook has to score each enquiry against inventory,
// which is how three separate buyers ended up filed against the same
// bungalow. Mapping one settles all of its leads at once, through
// POST /api/contacts/[id]/portal-link with the sample contact.

export interface UnmappedPortalAd {
  portal: string;
  portalListingId: string;
  leadCount: number;
  lastSeenAt: string;
  sampleContactId: string;
  sampleContactName: string | null;
  guessedPropertyId: string | null;
  guessedPropertyTitle: string | null;
}

interface AdRow {
  portal: string;
  portal_listing_id: string;
  lead_count: number;
  last_seen_at: string;
  sample_contact_id: string;
  sample_contact_name: string | null;
  guessed_property_id: string | null;
  guessed_property_title: string | null;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // Grouped and counted in SQL (AGENTS.md §2.6) — the browser-side
    // alternative is fetching every portal lead in the account to group
    // them, which grows with the mailbox rather than with the answer.
    const { data, error } = await ctx.supabase.rpc('unmapped_portal_ads', {
      target_account_id: ctx.accountId,
    });
    if (error) throw error;

    const ads: UnmappedPortalAd[] = ((data ?? []) as AdRow[]).map((row) => ({
      portal: row.portal,
      portalListingId: row.portal_listing_id,
      leadCount: Number(row.lead_count),
      lastSeenAt: row.last_seen_at,
      sampleContactId: row.sample_contact_id,
      sampleContactName: row.sample_contact_name,
      guessedPropertyId: row.guessed_property_id,
      guessedPropertyTitle: row.guessed_property_title,
    }));

    return NextResponse.json({ data: ads });
  } catch (err) {
    console.error('[GET /api/portals/unmapped-ads] Unexpected error:', err);
    return toErrorResponse(err);
  }
}
