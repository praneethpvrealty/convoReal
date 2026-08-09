import type { SupabaseClient } from '@supabase/supabase-js';
// ============================================================
// Buyer WhatsApp alert consent — the buyer-side twin of the owner
// digest STOP/START commands (src/lib/owners/owner-digest.ts).
// "STOP ALERTS" / "START ALERTS" free text in the buyer's chat
// toggles contacts.buyer_alerts_consent; the buyer portal settings
// screen edits the same column, so the two channels always agree.
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
  /** 'close' is the enquiry template's "Close my enquiry" button — the
   *  same consent decline as 'stop', but the goodbye can say more: the
   *  tap opened a 24-hour window, this reply is free-form, and it is
   *  the one legitimate moment to make the case for staying. The
   *  template promised "no further updates will be sent", so after
   *  this message there is no second nudge — the pitch rides the
   *  acknowledgment or it doesn't happen. */
  command: 'stop' | 'start' | 'close';
  accountId: string;
  contactId: string;
  db?: SupabaseClient;
}): Promise<string | null> {
  const db = args.db || supabaseAdmin();
  const { error } = await db
    .from('contacts')
    .update({
      buyer_alerts_consent: args.command === 'start' ? 'granted' : 'declined',
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId);
  if (error) {
    console.error('[buyer-alerts] consent update failed:', error.message);
    return null;
  }
  if (args.command === 'close') {
    return [
      'Understood — your enquiry is closed, and this is our last update. Thank you for considering us.',
      '',
      'One thing before we go: our intelligent listing engine matches every new property against your requirement the moment it arrives — and when a seller needs a quick exit, it sometimes catches a real steal deal, priced well under market. Our regular investors and buyers have found it genuinely worth staying on for.',
      '',
      "If you'd like it quietly watching for you, just reply START ALERTS. Otherwise, we wish you the very best with your search!",
    ].join('\n');
  }
  return args.command === 'stop'
    ? "Understood — you won't receive property alerts. Reply START ALERTS anytime if you change your mind."
    : "✅ Great! You'll receive property alerts that match your preferences. Reply STOP ALERTS anytime to pause.";
}
