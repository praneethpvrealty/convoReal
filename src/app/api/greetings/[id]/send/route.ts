import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  resolveAudienceOnServer,
  sendBroadcastRecipients,
  type AudienceConfig,
} from '@/lib/broadcasts/sender';
import {
  buildOccasionGreetingVariables,
  ensureOccasionGreetingTemplate,
} from '@/lib/whatsapp/occasion-greeting-template';
import { accountBrandImage } from '@/lib/showcase/account-showcase-url';
import { storagePublicUrl } from '@/lib/storage/url';
import type { OccasionGreeting } from '@/lib/greetings/types';

const INSERT_BATCH_SIZE = 200;
const AUDIENCE_TYPES = new Set(['all', 'tags']);

// POST /api/greetings/[id]/send — broadcast a greeting to the chosen
// audience on the shared occasion_greeting template. The fan-out is a
// normal broadcasts row, so delivery tracking, retry and the sweep cron
// all apply.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `broadcast:${ctx.userId}`,
      RATE_LIMITS.broadcast
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: greetingRow, error: gErr } = await ctx.supabase
      .from('occasion_greetings')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (gErr) {
      return NextResponse.json({ error: gErr.message }, { status: 500 });
    }
    if (!greetingRow) {
      return NextResponse.json(
        { error: 'Greeting not found' },
        { status: 404 }
      );
    }
    const greeting = greetingRow as OccasionGreeting;

    const body = await request.json().catch(() => null);
    const audience: AudienceConfig =
      body?.audience && AUDIENCE_TYPES.has(body.audience.type)
        ? {
            type: body.audience.type,
            tagIds: Array.isArray(body.audience.tagIds)
              ? body.audience.tagIds
              : undefined,
            excludeTagIds: Array.isArray(body.audience.excludeTagIds)
              ? body.audience.excludeTagIds
              : undefined,
          }
        : { type: 'all' };
    if (
      audience.type === 'tags' &&
      (!audience.tagIds || audience.tagIds.length === 0)
    ) {
      return NextResponse.json(
        { error: 'Pick at least one tag for a tag audience' },
        { status: 400 }
      );
    }
    const optedInOnly = body?.optedInOnly === true;

    const templateState = await ensureOccasionGreetingTemplate(ctx.accountId);
    if (!templateState.template) {
      if (templateState.status === null) {
        return NextResponse.json(
          {
            error:
              'WhatsApp is not connected for this account, so the greeting template could not be submitted. Connect WhatsApp in Settings first.',
            code: 'TEMPLATE_UNAVAILABLE',
          },
          { status: 400 }
        );
      }
      if (templateState.status === 'REJECTED') {
        return NextResponse.json(
          {
            error: `Meta rejected the greeting template${templateState.rejectionReason ? `: ${templateState.rejectionReason}` : ''}. Edit and resubmit it from Settings → Templates.`,
            code: 'TEMPLATE_REJECTED',
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error:
            'The greeting template is awaiting Meta approval — sends unlock the moment it is approved (usually within minutes to a few hours).',
          code: 'TEMPLATE_PENDING',
        },
        { status: 409 }
      );
    }
    const template = templateState.template;

    const resolved = await resolveAudienceOnServer(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      audience
    );
    // resolveAudienceOnServer already drops declined contacts; the
    // strict mode narrows a Marketing-category send to explicit grants
    // (contacts are asked free-form the first time they message in —
    // see src/lib/buyer/consent-ask.ts for why there is no ask template).
    const contacts = optedInOnly
      ? resolved.filter((c) => c.buyer_alerts_consent === 'granted')
      : resolved;
    if (contacts.length === 0) {
      return NextResponse.json(
        {
          error: optedInOnly
            ? 'No contacts in this audience have explicitly opted in yet. Clients are asked to opt in automatically the first time they message you on WhatsApp, and portal enquiry forms record consent too.'
            : 'Audience is empty. No contacts matched the criteria.',
        },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    const headerMediaUrl = greeting.image_path
      ? storagePublicUrl(greeting.image_path)
      : storagePublicUrl(await accountBrandImage(admin, ctx.accountId)) || null;

    const { data: broadcast, error: broadcastError } = await admin
      .from('broadcasts')
      .insert({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        name: `Greetings: ${greeting.occasion_label}`,
        template_name: template.name,
        template_language: template.language ?? 'en_US',
        template_variables: buildOccasionGreetingVariables(
          greeting.message_text,
          ctx.account.name
        ),
        audience_filter: { ...audience, optedInOnly },
        header_media_url: headerMediaUrl,
        status: 'sending',
        total_recipients: contacts.length,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      })
      .select()
      .single();
    if (broadcastError || !broadcast) {
      throw new Error(
        `Failed to create broadcast row: ${broadcastError?.message ?? 'unknown'}`
      );
    }

    const recipientRows = contacts.map((contact) => ({
      broadcast_id: broadcast.id,
      contact_id: contact.id,
      status: 'pending' as const,
    }));
    for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
      const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
      const { error: recipientError } = await admin
        .from('broadcast_recipients')
        .insert(batch);
      if (recipientError) {
        await admin
          .from('broadcasts')
          .update({ status: 'failed', failed_count: contacts.length })
          .eq('id', broadcast.id);
        throw new Error(
          `Failed to insert recipient batch: ${recipientError.message}`
        );
      }
    }

    const { data: markedSent } = await ctx.supabase
      .from('occasion_greetings')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        broadcast_id: broadcast.id,
      })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select('id');
    if (!markedSent || markedSent.length === 0) {
      console.error(
        `[Greeting Send] could not mark greeting ${id} as sent — broadcast ${broadcast.id} is dispatching regardless`
      );
    }

    const reqWithWaitUntil = request as Request & {
      waitUntil?: (promise: Promise<unknown>) => void;
    };
    const dispatch = sendBroadcastRecipients(
      broadcast.id,
      ctx.accountId,
      ctx.userId
    ).catch((err) => console.error('[Greeting Broadcast Send] error:', err));
    if (typeof reqWithWaitUntil.waitUntil === 'function') {
      reqWithWaitUntil.waitUntil(dispatch);
    } else {
      void dispatch;
    }

    return NextResponse.json({
      data: { broadcastId: broadcast.id, recipientsCount: contacts.length },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
