import type { SupabaseClient } from '@supabase/supabase-js';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { getVoiceConfig } from './config';
import { startOutboundCall } from './outbound-call';

/**
 * A reminder as a phone call — the Phase D leftover Phase B unblocks.
 * Fired by the appointment reminder cron for contacts whose
 * preferred_update_channel is voice_call, when the account has an
 * active voice config with reminder calls opted in and a default
 * agent_ref. Charged like any other call attempt
 * (AI_FEATURE_COSTS.voice_campaign_call, idempotent per reminder via
 * retryKey) and refunded when the call fails to start; the caller
 * falls back to the WhatsApp template so the reminder still lands.
 */
export async function placeReminderCall(args: {
  admin: SupabaseClient;
  accountId: string;
  contactId: string;
  phone: string;
  retryKey: string;
  context: Record<string, string>;
}): Promise<boolean> {
  const config = await getVoiceConfig(args.admin, args.accountId);
  if (
    !config?.is_active ||
    !config.reminder_calls_enabled ||
    !config.agent_ref
  ) {
    return false;
  }

  const cost = AI_FEATURE_COSTS.voice_campaign_call;
  const burn = await burnCredits(args.accountId, 'voice_campaign_call', cost, {
    retryKey: args.retryKey,
  });
  if (!burn.success) {
    console.warn(
      `[reminder-call] Insufficient credits for account ${args.accountId} — falling back to WhatsApp.`
    );
    return false;
  }

  const result = await startOutboundCall({
    agentId: config.agent_ref,
    phone: args.phone,
    context: args.context,
  });
  if (!result.ok) {
    console.error(
      `[reminder-call] Call start failed for contact ${args.contactId}: ${result.error}`
    );
    await refundCredits(args.accountId, 'voice_campaign_call', cost, {
      description: `voice reminder start-failure refund (contact ${args.contactId})`,
    });
    return false;
  }
  return true;
}
