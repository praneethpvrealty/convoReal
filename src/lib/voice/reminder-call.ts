import type { SupabaseClient } from '@supabase/supabase-js';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getVoiceConfig, resolveDialCredentials } from './config';
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
  if (!config?.is_active || !config.reminder_calls_enabled) return false;
  const credentials = resolveDialCredentials(config, null, decrypt);
  if (!credentials.ok) {
    console.warn(
      `[reminder-call] Cannot dial for account ${args.accountId}: ${credentials.error}`
    );
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
    agentId: credentials.agentId,
    apiKey: credentials.apiKey,
    provider: credentials.provider,
    phone: args.phone,
    // No campaign to key on, so the account rides with the call —
    // the shared pool's webhook URL names no tenant.
    context: { ...args.context, account_id: args.accountId },
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
