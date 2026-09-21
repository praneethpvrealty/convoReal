import type { SupabaseClient } from '@supabase/supabase-js';
// ============================================================
// Buyer WhatsApp alert consent — the buyer-side twin of the owner
// digest STOP/START commands (src/lib/owners/owner-digest.ts).
// "STOP ALERTS" / "START ALERTS" free text in the buyer's chat
// toggles contacts.buyer_alerts_consent; the buyer portal settings
// screen edits the same column, so the two channels always agree.
// "Close my enquiry" is not an alerts command any more — it closes one
// listing's enquiry (src/lib/whatsapp/enquiry-close.ts).
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin';

export function parseBuyerAlertsCommand(
  text: string | null | undefined
): 'stop' | 'start' | null {
  if (!text) return null;
  const cleaned = text.trim().toLowerCase();
  if (cleaned.length > 40) return null;
  if (/^(stop|pause)\s+(property\s+|deal\s+)?alerts?$/.test(cleaned))
    return 'stop';
  if (/^(start|resume)\s+(property\s+|deal\s+)?alerts?$/.test(cleaned))
    return 'start';
  return null;
}

export async function applyBuyerAlertsCommand(args: {
  command: 'stop' | 'start';
  accountId: string;
  contactId: string;
  db?: SupabaseClient;
}): Promise<string | null> {
  const db = args.db || supabaseAdmin();
  const now = new Date().toISOString();

  if (args.command === 'stop') {
    const { error } = await db
      .from('contacts')
      .update({ buyer_alerts_consent: 'declined', updated_at: now })
      .eq('id', args.contactId)
      .eq('account_id', args.accountId);
    if (error) {
      console.error('[buyer-alerts] consent update failed:', error.message);
      return null;
    }
    return "Understood — you won't receive property alerts. Reply START ALERTS anytime if you change your mind.";
  }

  // START ALERTS in the lead's own words is the lead re-opening their
  // search, whatever closed it: a contact marked dead is revived and
  // the requirement un-parked, or the consent just granted would never
  // produce an alert — the dispatcher, the matcher and the digest all
  // skip dead contacts.
  const { data: before } = await db
    .from('contacts')
    .select('is_dead')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle();
  const { error } = await db
    .from('contacts')
    .update({
      buyer_alerts_consent: 'granted',
      is_dead: false,
      dead_at: null,
      dead_reason: null,
      requirement_active: true,
      updated_at: now,
    })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId);
  if (error) {
    console.error('[buyer-alerts] consent update failed:', error.message);
    return null;
  }
  if ((before as { is_dead?: boolean | null } | null)?.is_dead) {
    await db.from('contact_notes').insert({
      contact_id: args.contactId,
      account_id: args.accountId,
      user_id: null,
      note_text: 'Lead reopened their search from WhatsApp (START ALERTS)',
    });
  }
  return "✅ Great! You'll receive property alerts that match your preferences. Reply STOP ALERTS anytime to pause.";
}
