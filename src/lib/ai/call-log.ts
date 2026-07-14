import { createClient } from '@supabase/supabase-js';

/**
 * Fire-and-forget telemetry for Gemini calls (see migration 123).
 *
 * Inert until the operator sets system_settings 'ai_call_log' to
 * {"enabled": true}. The flag is cached in-process for 60s so logging
 * adds zero DB reads to the AI hot path once warmed. Logging must never
 * throw or delay a user request — every failure path here swallows.
 */

let _adminClient: ReturnType<typeof createClient> | null = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

const FLAG_TTL_MS = 60_000;
const PREVIEW_CHARS = 500;

let flagCache: { enabled: boolean; fetchedAt: number } | null = null;

async function isLoggingEnabled(): Promise<boolean> {
  if (flagCache && Date.now() - flagCache.fetchedAt < FLAG_TTL_MS) {
    return flagCache.enabled;
  }
  try {
    const { data } = await supabaseAdmin()
      .from('system_settings')
      .select('value')
      .eq('key', 'ai_call_log')
      .maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    const enabled = (value as { enabled?: boolean } | null)?.enabled === true;
    flagCache = { enabled, fetchedAt: Date.now() };
    return enabled;
  } catch {
    flagCache = { enabled: false, fetchedAt: Date.now() };
    return false;
  }
}

export interface AiCallLogEntry {
  feature?: string;
  model: string;
  tier?: string;
  success: boolean;
  errorMessage?: string;
  latencyMs: number;
  jsonMode: boolean;
  hasMedia: boolean;
  promptTokens?: number | null;
  responseTokens?: number | null;
  promptChars: number;
  responseChars?: number;
  systemPreview?: string;
  inputPreview?: string;
  outputPreview?: string;
}

/** Fire-and-forget — call without await; never throws. */
export function logAiCall(entry: AiCallLogEntry): void {
  void (async () => {
    try {
      if (!(await isLoggingEnabled())) return;
      await supabaseAdmin().from('ai_call_log').insert({
        feature: entry.feature ?? null,
        model: entry.model,
        tier: entry.tier ?? null,
        success: entry.success,
        error_message: entry.errorMessage?.slice(0, PREVIEW_CHARS) ?? null,
        latency_ms: Math.round(entry.latencyMs),
        json_mode: entry.jsonMode,
        has_media: entry.hasMedia,
        prompt_tokens: entry.promptTokens ?? null,
        response_tokens: entry.responseTokens ?? null,
        prompt_chars: entry.promptChars,
        response_chars: entry.responseChars ?? null,
        system_preview: entry.systemPreview?.slice(0, 80) ?? null,
        input_preview: entry.inputPreview?.slice(0, PREVIEW_CHARS) ?? null,
        output_preview: entry.outputPreview?.slice(0, PREVIEW_CHARS) ?? null,
      } as unknown as never);
    } catch {
      // Telemetry must never surface into the AI call path.
    }
  })();
}
