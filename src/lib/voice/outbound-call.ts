/**
 * Thin client for triggering a Sarvam Voice Agents outbound call.
 *
 * The endpoint path is env-overridable because Sarvam's Voice Agents
 * API is newly GA and still moving (docs/voice-agent-integration-plan.md
 * header note) — verify SARVAM_OUTBOUND_CALL_PATH against
 * https://docs.sarvam.ai before pointing production at it. Auth is the
 * same `api-subscription-key` header the listing-video worker already
 * uses for translate/TTS.
 *
 * VOICE_CALLS_DRY_RUN=true short-circuits with a synthetic call id so
 * the whole campaign pipeline can be exercised without a Sarvam
 * workspace or phone bill, mirroring WHATSAPP_TEMPLATES_DRY_RUN.
 */

import { randomUUID } from 'node:crypto';

export interface OutboundCallRequest {
  agentId: string;
  phone: string;
  context: Record<string, string>;
}

export type OutboundCallResult =
  | { ok: true; callId: string | null; dryRun: boolean }
  | { ok: false; error: string };

export async function startOutboundCall(
  req: OutboundCallRequest
): Promise<OutboundCallResult> {
  if (process.env.VOICE_CALLS_DRY_RUN === 'true') {
    return { ok: true, callId: `dry-run-${randomUUID()}`, dryRun: true };
  }

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'SARVAM_API_KEY is not set' };
  }
  const base = process.env.SARVAM_API_BASE || 'https://api.sarvam.ai';
  const path =
    process.env.SARVAM_OUTBOUND_CALL_PATH || '/v1/voice-agents/calls';

  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: req.agentId,
        phone_number: req.phone,
        variables: req.context,
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `Sarvam ${path} → HTTP ${res.status}: ${raw.slice(0, 300)}`,
      };
    }
    let callId: string | null = null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const id = parsed.call_id ?? parsed.id;
      callId = typeof id === 'string' ? id : null;
    } catch {
      callId = null;
    }
    return { ok: true, callId, dryRun: false };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
