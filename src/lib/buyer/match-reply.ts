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
import { curateForBuyer, hasBuyerBrief } from './matches-ranking';
import {
  buildMatchDigestMessage,
  buildNoMatchesMessage,
  MAX_DIGEST_MATCHES,
} from './digest';

const POOL_LIMIT = 300;

function portalUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl).replace(/\/$/, '');
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
    // No brief on file — this isn't a buyer asking about their matches,
    // it's someone using a word we happen to watch for. Fall through to
    // normal handling rather than answering with a listing dump.
    if (!hasBuyerBrief(contact)) return null;

    const { data: poolRows } = await db
      .from('properties')
      .select('*')
      .eq('account_id', args.accountId)
      .eq('is_published', true)
      .eq('status', 'Available')
      .order('created_at', { ascending: false })
      .limit(POOL_LIMIT);

    const matches = curateForBuyer((poolRows || []) as Property[], contact, {
      limit: MAX_DIGEST_MATCHES,
    });
    if (matches.length === 0) return buildNoMatchesMessage(contact.name);

    return buildMatchDigestMessage({
      contactName: contact.name,
      matches,
      portalUrl: portalUrl(),
    });
  } catch (err) {
    console.error('[buyer-match-reply] failed:', err);
    return null;
  }
}
