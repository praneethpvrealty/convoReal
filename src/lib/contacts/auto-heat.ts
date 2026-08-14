// ============================================================
// Auto-heat — mark a lead HOT from their own behaviour.
//
// The Today page's "HOT going quiet" watchdog and the follow-up cron
// both key on contacts.lead_temp = 'HOT', and lead_temp is set by hand.
// A Magic Bricks lead with a ₹5-10 Cr budget who enquired on two
// listings and asked "is the price negotiable" sat at lead_temp null —
// invisible to the exact machinery built to stop him going cold.
//
// So the flag is now also set by the webhook when the lead's own words
// show heat: a deliberate enquiry (property code in the message), a
// price/negotiation question, or site-visit intent. Only ever an
// upgrade from unset: an agent's explicit HOT/COLD/Not Responding/Dead
// is a judgement this must never overwrite.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Only buyers heat up. A seller asking about price is negotiating
 *  their own listing, not going hot on someone else's. */
const HEATABLE_CLASSIFICATIONS = new Set(['Buyer', 'Owner & Buyer', 'Others']);

const PRICE_NEGOTIATION =
  /\b(negotiable|negotiat\w*|best\s+price|final\s+price|last\s+price|any\s+discount|price\s+ka\s+kya|can\s+(?:we|you)\s+(?:do|close)\s+(?:it\s+)?(?:at|for)|(?:kitna|kya)\s+(?:final|last))\b/i;

const SITE_VISIT_INTENT =
  /\b(site\s*visit|(?:want|like|love)\s+to\s+(?:visit|see)\s+(?:it|the)|can\s+i\s+(?:visit|come\s+and\s+see)|schedule\s+a\s+visit|show\s+me\s+the\s+(?:site|property|plot|house|flat))\b/i;

/**
 * True when the lead's message carries a buying signal strong enough
 * to mark them HOT on its own: price negotiation or site-visit intent.
 * Deliberately tight — a false HOT costs an agent a pointless nudge
 * card every week until they downgrade it.
 */
export function carriesHotSignal(text?: string | null): boolean {
  const value = (text || '').trim();
  if (!value) return false;
  return PRICE_NEGOTIATION.test(value) || SITE_VISIT_INTENT.test(value);
}

export interface AutoHeatArgs {
  db: SupabaseClient;
  accountId: string;
  contact: {
    id: string;
    lead_temp?: string | null;
    classification?: string | null;
  };
  text?: string | null;
  /** The message names a listing by its property code — the strongest
   *  signal there is, decided by the webhook's matcher, not re-derived
   *  here. */
  explicitEnquiry?: boolean;
}

/**
 * Upgrades an unset lead_temp to HOT when the message shows heat.
 * Returns whether the upgrade happened. Never throws — a failed heat
 * write must not take the webhook's reply down with it.
 */
export async function maybeAutoHeatContact(
  args: AutoHeatArgs
): Promise<boolean> {
  const { db, accountId, contact } = args;
  if (contact.lead_temp) return false;
  if (!HEATABLE_CLASSIFICATIONS.has(contact.classification || 'Others')) {
    return false;
  }
  if (!args.explicitEnquiry && !carriesHotSignal(args.text)) return false;

  try {
    const { error } = await db
      .from('contacts')
      .update({ lead_temp: 'HOT', updated_at: new Date().toISOString() })
      .eq('id', contact.id)
      .eq('account_id', accountId)
      .is('lead_temp', null);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[auto-heat] failed (non-fatal):', err);
    return false;
  }
}
