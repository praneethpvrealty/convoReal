// ============================================================
// Auto-heat — mark a lead HOT after their inbound reply.
//
// The Today page's "HOT going quiet" watchdog and the follow-up cron
// both key on contacts.lead_temp = 'HOT', and lead_temp is set by hand.
// Only an inbound customer message reaches this helper. Portal imports,
// property matching and outbound messages never do. Only ever an upgrade
// from unset: an agent's explicit temperature is never overwritten.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Only buyers heat up. A seller asking about price is negotiating
 *  their own listing, not going hot on someone else's. */
const HEATABLE_CLASSIFICATIONS = new Set(['Buyer', 'Owner & Buyer', 'Others']);

export interface AutoHeatArgs {
  db: SupabaseClient;
  accountId: string;
  contact: {
    id: string;
    lead_temp?: string | null;
    classification?: string | null;
  };
}

/**
 * Upgrades an unset buyer lead_temp to HOT after their inbound reply.
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
