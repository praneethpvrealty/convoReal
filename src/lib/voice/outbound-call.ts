/**
 * Provider-pluggable client for triggering an outbound voice-agent
 * call. Sarvam is the default; VOICE_CALL_PROVIDER=custom posts the
 * same normalised request to any HTTP bridge (Twilio middleware,
 * Exotel, a self-hosted stack), so a Sarvam outage or pricing change
 * is an env flip, not a code change. Every provider reports results
 * through the same /api/webhooks/voice-agent contract, and a
 * campaign's agent_ref names the agent in whichever provider is
 * active — switch providers and the refs must exist there too.
 *
 * The Sarvam endpoint path is env-overridable because their Voice
 * Agents API is newly GA and still moving
 * (docs/voice-agent-integration-plan.md header note) — verify
 * SARVAM_OUTBOUND_CALL_PATH against https://docs.sarvam.ai before
 * production. Auth is the same `api-subscription-key` header the
 * listing-video worker already uses for translate/TTS.
 *
 * VOICE_CALLS_DRY_RUN=true short-circuits with a synthetic call id so
 * the whole campaign pipeline can be exercised without a workspace or
 * phone bill, mirroring WHATSAPP_TEMPLATES_DRY_RUN.
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

async function postCall(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<OutboundCallResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `${new URL(url).pathname} → HTTP ${res.status}: ${raw.slice(0, 300)}`,
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

async function sarvamCall(
  req: OutboundCallRequest
): Promise<OutboundCallResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'SARVAM_API_KEY is not set' };
  }
  const base = process.env.SARVAM_API_BASE || 'https://api.sarvam.ai';
  const path =
    process.env.SARVAM_OUTBOUND_CALL_PATH || '/v1/voice-agents/calls';
  return postCall(
    `${base}${path}`,
    { 'api-subscription-key': apiKey },
    {
      agent_id: req.agentId,
      phone_number: req.phone,
      variables: req.context,
    }
  );
}

async function customCall(
  req: OutboundCallRequest
): Promise<OutboundCallResult> {
  const url = process.env.VOICE_CALL_CUSTOM_URL;
  if (!url) {
    return { ok: false, error: 'VOICE_CALL_CUSTOM_URL is not set' };
  }
  const token = process.env.VOICE_CALL_CUSTOM_TOKEN;
  return postCall(url, token ? { Authorization: `Bearer ${token}` } : {}, {
    agent_ref: req.agentId,
    phone_number: req.phone,
    variables: req.context,
  });
}

export async function startOutboundCall(
  req: OutboundCallRequest
): Promise<OutboundCallResult> {
  if (process.env.VOICE_CALLS_DRY_RUN === 'true') {
    return { ok: true, callId: `dry-run-${randomUUID()}`, dryRun: true };
  }
  const provider = process.env.VOICE_CALL_PROVIDER || 'sarvam';
  if (provider === 'sarvam') return sarvamCall(req);
  if (provider === 'custom') return customCall(req);
  return { ok: false, error: `Unknown VOICE_CALL_PROVIDER: ${provider}` };
}
