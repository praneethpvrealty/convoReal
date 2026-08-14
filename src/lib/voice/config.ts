import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-account voice provider configuration (Phase B). Service-role
 * callers (webhook, dispatcher, reminder cron) read through here so
 * the shape stays in one place; the settings route talks to the table
 * directly under RLS.
 */

export const VOICE_MODES = ['shared', 'dedicated', 'byo'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export function isVoiceMode(v: unknown): v is VoiceMode {
  return (
    typeof v === 'string' && (VOICE_MODES as readonly string[]).includes(v)
  );
}

export interface VoiceAgentConfig {
  account_id: string;
  mode: VoiceMode;
  provider: string | null;
  api_key_encrypted: string | null;
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
      'account_id, mode, provider, api_key_encrypted, agent_ref, phone_number, webhook_token, is_active, reminder_calls_enabled, reminder_audio_enabled'
    )
    .eq('account_id', accountId)
    .maybeSingle();
  return (data as VoiceAgentConfig | null) ?? null;
}

export type DialCredentials =
  | {
      ok: true;
      agentId: string;
      apiKey: string | null;
      provider: string | null;
      mode: VoiceMode;
    }
  | { ok: false; error: string };

/**
 * What to dial with, for one account.
 *
 * The three modes differ only here — everything downstream sees the
 * same request. `shared` borrows the platform's agent so an account
 * can run a campaign having provisioned nothing; `dedicated` names
 * the account's own agent inside the platform workspace; `byo` also
 * swaps in the account's own provider credentials, so the minutes
 * bill to them.
 *
 * campaignAgentRef wins over the account default in the two modes
 * that use account-owned agents, and is ignored in `shared` — a
 * campaign cannot borrow the pool and point it at a private agent.
 */
export function resolveDialCredentials(
  config: VoiceAgentConfig | null,
  campaignAgentRef: string | null,
  decryptKey: (encrypted: string) => string
): DialCredentials {
  const mode: VoiceMode = config?.mode ?? 'shared';

  if (mode === 'shared') {
    const agentId = process.env.VOICE_SHARED_AGENT_ID;
    if (!agentId) {
      return {
        ok: false,
        error:
          'Shared voice agent is not configured on this deployment (VOICE_SHARED_AGENT_ID)',
      };
    }
    return { ok: true, agentId, apiKey: null, provider: null, mode };
  }

  const agentId = campaignAgentRef || config?.agent_ref || null;
  if (!agentId) {
    return { ok: false, error: 'No voice agent id set for this account' };
  }

  if (mode === 'dedicated') {
    return { ok: true, agentId, apiKey: null, provider: null, mode };
  }

  if (!config?.api_key_encrypted) {
    return {
      ok: false,
      error: 'Bring-your-own mode selected but no provider API key is stored',
    };
  }
  try {
    return {
      ok: true,
      agentId,
      apiKey: decryptKey(config.api_key_encrypted),
      provider: config.provider,
      mode,
    };
  } catch {
    return { ok: false, error: 'Stored provider API key could not be read' };
  }
}
