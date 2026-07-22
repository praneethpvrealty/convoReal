// ============================================================
// Buyer WhatsApp alert consent — the buyer-side twin of the owner
// digest STOP/START commands (src/lib/owners/owner-digest.ts).
// "STOP ALERTS" / "START ALERTS" free text in the buyer's chat
// toggles contacts.buyer_alerts_consent; the buyer portal settings
// screen edits the same column, so the two channels always agree.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

let _adminClient: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

export async function applyBuyerAlertsCommand(args: {
  command: 'stop' | 'start';
  accountId: string;
  contactId: string;
  db?: SupabaseClient;
}): Promise<string | null> {
  const db = args.db || supabaseAdmin();
  const { error } = await db
    .from('contacts')
    .update({
      buyer_alerts_consent: args.command === 'stop' ? 'declined' : 'granted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId);
  if (error) {
    console.error('[buyer-alerts] consent update failed:', error.message);
    return null;
  }
  return args.command === 'stop'
    ? "Understood — you won't receive property alerts. Reply START ALERTS anytime if you change your mind."
    : "✅ Great! You'll receive property alerts that match your preferences. Reply STOP ALERTS anytime to pause.";
}
