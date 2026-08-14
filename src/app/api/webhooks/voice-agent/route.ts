import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { resolveConversation } from '@/lib/conversations/resolve';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';
import {
  isPlaceholderLeadName,
  placeholderLeadName,
} from '@/lib/contacts/lead-placeholder';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { interestFromTypeText } from '@/app/api/leads/email-webhook/route';
import { assignTagsToContact } from '@/app/api/leads/email-webhook/db-utils';
import { refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { getVoiceConfig } from '@/lib/voice/config';
import { generateMatchEventForContact } from '@/lib/radar/engine';
import {
  nextRecipientStatus,
  parseQualification,
  qualificationTags,
  type Qualification,
} from '@/lib/voice/campaigns';

const VOICE_WEBHOOK_LIMIT = { limit: 60, windowMs: 60_000 };
const VOICE_AGENT_SOURCE = 'Voice Agent';
const UNIQUE_VIOLATION = '23505';

const CALL_OUTCOMES = new Set([
  'connected',
  'no_answer',
  'busy',
  'voicemail',
  'wrong_number',
  'callback_requested',
]);

const SUMMARY_MAX = 2_000;
const TRANSCRIPT_MAX = 20_000;
const AREA_MAX = 80;
const AREAS_MAX_COUNT = 10;

export interface VoiceCallPayload {
  callId: string | null;
  accountId: string | null;
  callerPhone: string;
  callerName: string | null;
  direction: 'inbound' | 'outbound';
  outcome: string;
  durationSeconds: number | null;
  calledAt: string | null;
  language: string | null;
  summary: string | null;
  transcript: string | null;
  requirementText: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  areas: string[];
  propertyInterest: string | null;
  campaignId: string | null;
  qualification: Qualification | null;
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Normalise the provider's post-call payload; null when it carries no
 *  usable caller phone, the one field the ingestion cannot work without. */
export function parseVoiceCallPayload(body: unknown): VoiceCallPayload | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const callerPhone = asText(raw.caller_phone, 40);
  if (!callerPhone) return null;

  const requirement =
    raw.requirement && typeof raw.requirement === 'object'
      ? (raw.requirement as Record<string, unknown>)
      : {};

  let outcome =
    typeof raw.outcome === 'string' && CALL_OUTCOMES.has(raw.outcome)
      ? raw.outcome
      : 'connected';
  if (raw.callback_requested === true && outcome === 'connected') {
    outcome = 'callback_requested';
  }

  const duration = Number(raw.duration_seconds);
  const calledAtRaw = asText(raw.called_at, 40);
  const calledAtMs = calledAtRaw ? Date.parse(calledAtRaw) : NaN;

  const budget = Number(requirement.budget_max);
  const budgetMin = Number(requirement.budget_min);

  const areas = Array.isArray(requirement.areas)
    ? [
        ...new Set(
          requirement.areas
            .map((a) => asText(a, AREA_MAX))
            .filter((a): a is string => a !== null)
        ),
      ].slice(0, AREAS_MAX_COUNT)
    : [];

  return {
    callId: asText(raw.call_id, 128),
    accountId: asText(raw.account_id, 64),
    callerPhone,
    callerName: asText(raw.caller_name, 120),
    direction: raw.direction === 'outbound' ? 'outbound' : 'inbound',
    outcome,
    durationSeconds:
      Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : null,
    calledAt: Number.isFinite(calledAtMs)
      ? new Date(calledAtMs).toISOString()
      : null,
    language: asText(raw.language, 20),
    summary: asText(raw.summary, SUMMARY_MAX),
    transcript: asText(raw.transcript, TRANSCRIPT_MAX),
    requirementText: asText(requirement.text, SUMMARY_MAX),
    budgetMin: Number.isFinite(budgetMin) && budgetMin > 0 ? budgetMin : null,
    budgetMax: Number.isFinite(budget) && budget > 0 ? budget : null,
    areas,
    propertyInterest: asText(requirement.property_interest, 120),
    campaignId: asText(raw.campaign_id, 64),
    qualification: parseQualification(raw.qualification),
  };
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token') || '';
    const urlAccountId = searchParams.get('account_id') || '';

    // Token is REQUIRED — fail closed. The account's own webhook token
    // (voice_agent_config, Phase B) is the primary credential; the
    // global VOICE_AGENT_WEBHOOK_TOKEN stays as a deprecation
    // fallback. With neither configured the endpoint stays shut, since
    // it creates contacts and call-journal rows inside a tenant's
    // workspace.
    const tokenMatches = (expected: string | null | undefined): boolean => {
      if (!expected || !token) return false;
      const tokenBuf = Buffer.from(token);
      const expectedBuf = Buffer.from(expected);
      return (
        tokenBuf.length === expectedBuf.length &&
        timingSafeEqual(tokenBuf, expectedBuf)
      );
    };
    const platformAuthorized = tokenMatches(
      process.env.VOICE_AGENT_WEBHOOK_TOKEN
    );
    let authorized = platformAuthorized;
    if (!authorized && urlAccountId) {
      try {
        const config = await getVoiceConfig(supabaseAdmin(), urlAccountId);
        authorized = tokenMatches(config?.webhook_token);
      } catch {
        // Config unreachable — stays unauthorized rather than open.
      }
    }
    if (!authorized) {
      if (!process.env.VOICE_AGENT_WEBHOOK_TOKEN && !urlAccountId) {
        return NextResponse.json(
          { error: 'Webhook not configured' },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: 'Unauthorized token' },
        { status: 401 }
      );
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const limit = await checkRateLimit(
      `voice-agent-webhook:${ip}`,
      VOICE_WEBHOOK_LIMIT
    );
    if (!limit.success) return rateLimitResponse(limit);

    const payload = parseVoiceCallPayload(
      await request.json().catch(() => null)
    );
    if (!payload) {
      return NextResponse.json(
        { error: 'caller_phone is required' },
        { status: 400 }
      );
    }

    // Whose workspace this call belongs to. A per-account webhook URL
    // names it and always wins — a body field must never redirect a
    // result into a tenant whose token was not presented. Only the
    // shared pool arrives without one, because its agent serves every
    // account from a single URL authorized by the platform token; the
    // account then rides in the payload, echoed from the call
    // variables the dispatcher sent.
    let accountId = urlAccountId;
    if (!accountId && platformAuthorized) {
      accountId = payload.accountId ?? '';
      if (!accountId && payload.campaignId) {
        const { data: campaign } = await supabaseAdmin()
          .from('voice_campaigns')
          .select('account_id')
          .eq('id', payload.campaignId)
          .maybeSingle();
        accountId = (campaign?.account_id as string | undefined) ?? '';
      }
    }
    if (!accountId) {
      return NextResponse.json(
        { error: 'account_id is required' },
        { status: 400 }
      );
    }

    const phone = normalizePhoneWithCountryCode(payload.callerPhone);
    if (!phone) {
      return NextResponse.json(
        { error: 'caller_phone is invalid' },
        { status: 422 }
      );
    }

    const supabase = supabaseAdmin();

    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle();
    if (!profile) {
      return NextResponse.json(
        { error: 'Invalid account ID' },
        { status: 400 }
      );
    }

    const name =
      payload.callerName && !isPlaceholderLeadName(payload.callerName)
        ? payload.callerName
        : placeholderLeadName(VOICE_AGENT_SOURCE);
    const interest = payload.propertyInterest
      ? interestFromTypeText(payload.propertyInterest)
      : null;

    const statedAreas = payload.qualification?.statedAreas ?? [];
    const { contactId, isNew } = await findOrCreateContact(supabase, {
      accountId,
      userId: profile.user_id,
      phone,
      name,
      source: VOICE_AGENT_SOURCE,
      classification: 'Buyer',
      minBudget: payload.budgetMin,
      maxBudget: payload.qualification?.statedBudget ?? payload.budgetMax,
      areasOfInterest: statedAreas.length > 0 ? statedAreas : payload.areas,
      propertyInterests: interest ? [interest] : [],
    });

    const notes = [
      payload.requirementText,
      payload.language ? `Language: ${payload.language}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const { data: callLog, error: callErr } = await supabase
      .from('contact_call_logs')
      .insert({
        account_id: accountId,
        contact_id: contactId,
        user_id: profile.user_id,
        called_at: payload.calledAt ?? new Date().toISOString(),
        direction: payload.direction,
        duration_seconds: payload.durationSeconds,
        outcome: payload.outcome,
        notes: notes || null,
        summary: payload.summary,
        transcript: payload.transcript,
        source: 'voice_agent',
        external_call_id: payload.callId,
      })
      .select('id')
      .single();

    if (callErr?.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ status: 'duplicate', contactId });
    }
    if (callErr || !callLog) {
      console.error('[voice-agent-webhook] Call log insert failed:', callErr);
      return NextResponse.json(
        { error: 'Failed to record call' },
        { status: 500 }
      );
    }

    const preview = `📞 ${VOICE_AGENT_SOURCE} call (${payload.outcome}): ${
      payload.summary || payload.requirementText || 'call logged'
    }`.slice(0, 300);
    // No `last_customer_message_at`: that column anchors Meta's 24-hour
    // free-form window, and a phone call is not a WhatsApp message.
    const threadState = {
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      awaiting_reply: true,
    };
    const { conversation, created } = await resolveConversation<{ id: string }>(
      supabase,
      {
        accountId,
        contactId,
        userId: profile.user_id,
        onCreate: threadState,
        columns: 'id',
      }
    );
    if (conversation && !created) {
      await supabase
        .from('conversations')
        .update({ ...threadState, updated_at: new Date().toISOString() })
        .eq('id', conversation.id);
    }

    if (payload.campaignId) {
      const { data: recipient } = await supabase
        .from('voice_campaign_recipients')
        .select(
          'id, status, attempts, charged_credits, campaign:voice_campaigns(max_attempts)'
        )
        .eq('account_id', accountId)
        .eq('campaign_id', payload.campaignId)
        .eq('contact_id', contactId)
        .maybeSingle();
      if (recipient) {
        const campaignRow = Array.isArray(recipient.campaign)
          ? recipient.campaign[0]
          : recipient.campaign;
        const status = payload.qualification?.doNotCall
          ? 'opted_out'
          : nextRecipientStatus(
              payload.outcome,
              recipient.attempts,
              campaignRow?.max_attempts ?? 3
            );
        await supabase
          .from('voice_campaign_recipients')
          .update({
            status,
            call_log_id: callLog.id,
            qualification: payload.qualification ?? null,
          })
          .eq('id', recipient.id)
          .select('id');
        // The attempt was charged at dispatch; a call nobody answered
        // is returned, so accounts pay per connected call. Guarded on
        // the pre-update 'calling' status so a stale-requeue refund
        // (dispatcher) and this one can never both fire for the same
        // attempt.
        if (
          recipient.status === 'calling' &&
          (payload.outcome === 'no_answer' || payload.outcome === 'busy')
        ) {
          // Exactly what this attempt was charged (migration 279) —
          // the account's mode, and so its price, may have changed
          // since the dial.
          await refundCredits(
            accountId,
            'voice_campaign_call',
            recipient.charged_credits ?? AI_FEATURE_COSTS.voice_campaign_call,
            {
              description: `voice_campaign_call no-answer refund (recipient ${recipient.id})`,
            }
          );
        }
      }
    }

    if (payload.qualification?.doNotCall) {
      await supabase
        .from('contacts')
        .update({ do_not_call: true })
        .eq('account_id', accountId)
        .eq('id', contactId)
        .select('id');
    }
    const tags = payload.qualification
      ? qualificationTags(payload.qualification)
      : [];
    if (tags.length > 0) {
      await assignTagsToContact(
        supabase,
        accountId,
        profile.user_id,
        contactId,
        tags
      );
    }

    // Phase E: the call stated a requirement, so the preference fields
    // just changed — rank the account's inventory against them and file
    // a Match Radar event, the same hook preference edits and the
    // public requirements form fire. Failures are swallowed inside.
    if (
      payload.qualification ||
      payload.requirementText ||
      payload.budgetMax ||
      payload.areas.length > 0
    ) {
      await generateMatchEventForContact(supabase, accountId, contactId);
    }

    if (isNew) {
      void runAutomationsForTrigger({
        accountId,
        triggerType: 'new_contact_created',
        contactId,
      });
    }

    return NextResponse.json({
      status: isNew ? 'created' : 'updated',
      contactId,
      callLogId: callLog.id,
    });
  } catch (err) {
    const error = err as Error;
    console.error('[voice-agent-webhook] Request failed:', error);
    return NextResponse.json(
      { error: error.message || 'Server error' },
      { status: 500 }
    );
  }
}
