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
    const accountId = searchParams.get('account_id') || '';

    // Token is REQUIRED — fail closed. A missing VOICE_AGENT_WEBHOOK_TOKEN
    // must never leave the endpoint open, since it creates contacts and
    // call-journal rows inside a tenant's workspace.
    const expectedToken = process.env.VOICE_AGENT_WEBHOOK_TOKEN;
    if (!expectedToken) {
      console.error(
        '[voice-agent-webhook] VOICE_AGENT_WEBHOOK_TOKEN is not set — rejecting request.'
      );
      return NextResponse.json(
        { error: 'Webhook not configured' },
        { status: 503 }
      );
    }
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expectedToken);
    if (
      tokenBuf.length !== expectedBuf.length ||
      !timingSafeEqual(tokenBuf, expectedBuf)
    ) {
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

    if (!accountId) {
      return NextResponse.json(
        { error: 'account_id is required' },
        { status: 400 }
      );
    }

    const payload = parseVoiceCallPayload(
      await request.json().catch(() => null)
    );
    if (!payload) {
      return NextResponse.json(
        { error: 'caller_phone is required' },
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
        .select('id, attempts, campaign:voice_campaigns(max_attempts)')
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
