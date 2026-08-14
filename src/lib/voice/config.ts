import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-account voice provider configuration (Phase B). Service-role
 * callers (webhook, dispatcher, reminder cron) read through here so
 * the shape stays in one place; the settings route talks to the table
 * directly under RLS.
 */

export interface VoiceAgentConfig {
  account_id: string;
  agent_ref: string | null;
  phone_number: string | null;
  webhook_token: string;
  is_active: boolean;
  reminder_calls_enabled: boolean;
  reminder_audio_enabled: boolean;
}

export async function getVoiceConfig(
  admin: SupabaseClient,
  accountId: string
): Promise<VoiceAgentConfig | null> {
  const { data } = await admin
    .from('voice_agent_config')
    .select(
      'account_id, agent_ref, phone_number, webhook_token, is_active, reminder_calls_enabled, reminder_audio_enabled'
    )
    .eq('account_id', accountId)
    .maybeSingle();
  return (data as VoiceAgentConfig | null) ?? null;
}
