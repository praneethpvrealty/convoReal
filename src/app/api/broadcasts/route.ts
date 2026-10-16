import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  resolveAudienceOnServer,
  sendBroadcastRecipients,
} from '@/lib/broadcasts/sender';
import { parseAudience } from '@/lib/broadcasts/audience';
import {
  broadcastMessageProblem,
  broadcastTemplateBlockReason,
  BROADCAST_MESSAGE_MAX,
  buildBroadcastUpdateVariables,
} from '@/lib/broadcasts/carrier-template';
import { ensureBroadcastUpdateTemplate } from '@/lib/whatsapp/broadcast-update-template';

const INSERT_BATCH_SIZE = 200;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    // Enforce per-user broadcast campaign start limit
    const limit = await checkRateLimit(
      `broadcast:${ctx.userId}`,
      RATE_LIMITS.broadcast
    );
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { name, audience, message } = body;
    const composed = typeof message === 'string';
    const optedInOnly = body.optedInOnly === true;

    if (
      !name ||
      !audience ||
      (!composed && (!body.template || !body.variables))
    ) {
      return NextResponse.json(
        {
          error: 'Missing required fields: name, message, audience',
        },
        { status: 400 }
      );
    }

    const parsedAudience = parseAudience(audience);
    if ('error' in parsedAudience) {
      return NextResponse.json(
        { error: parsedAudience.error },
        { status: 400 }
      );
    }

    // The composer never asks for a template: the message rides on the
    // account's shared carrier, submitted to Meta once on its own. The
    // template + variables shape stays accepted for app builds that
    // predate the composer change.
    let template: { name: string; language?: string | null };
    let variables: Record<string, unknown>;
    if (composed) {
      const problem = broadcastMessageProblem(message);
      if (problem) {
        return NextResponse.json(
          {
            error:
              problem === 'empty'
                ? 'Write the message before sending.'
                : `Keep the message within ${BROADCAST_MESSAGE_MAX} characters.`,
          },
          { status: 400 }
        );
      }
      const state = await ensureBroadcastUpdateTemplate(ctx.accountId);
      if (!state.template) {
        return NextResponse.json(
          {
            error: broadcastTemplateBlockReason(state),
            code:
              state.status === null
                ? 'TEMPLATE_UNAVAILABLE'
                : state.status === 'REJECTED'
                  ? 'TEMPLATE_REJECTED'
                  : 'TEMPLATE_PENDING',
          },
          { status: state.status === null ? 400 : 409 }
        );
      }
      template = state.template;
      variables = buildBroadcastUpdateVariables(message, ctx.account.name);
    } else {
      template = body.template;
      variables = body.variables;
    }

    const admin = supabaseAdmin();

    // 1. Resolve contacts server-side
    // Declined contacts are always dropped; the carrier is a Marketing
    // template, so the composer also offers narrowing to explicit
    // grants, the same switch the occasion greeting has.
    const contacts = await resolveAudienceOnServer(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      parsedAudience.audience,
      { optedInOnly }
    );

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

    // 2. Create the broadcasts row
    const { data: broadcast, error: broadcastError } = await admin
      .from('broadcasts')
      .insert({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        name: name.trim(),
        template_name: template.name,
        template_language: template.language ?? 'en_US',
        template_variables: variables,
        audience_filter: parsedAudience.audience,
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

    // 3. Batch insert recipient rows
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
        // Rollback status to failed if recipients insertion failed
        await admin
          .from('broadcasts')
          .update({
            status: 'failed',
            failed_count: contacts.length,
          })
          .eq('id', broadcast.id);

        throw new Error(
          `Failed to insert recipient batch: ${recipientError.message}`
        );
      }
    }

    // 4. Trigger background dispatch in fire-and-forget style or via waitUntil
    const reqWithWaitUntil = request as Request & {
      waitUntil?: (promise: Promise<unknown>) => void;
    };
    if (typeof reqWithWaitUntil.waitUntil === 'function') {
      reqWithWaitUntil.waitUntil(
        sendBroadcastRecipients(broadcast.id, ctx.accountId, ctx.userId).catch(
          (err) => console.error('[Broadcast Background Send] error:', err)
        )
      );
    } else {
      void sendBroadcastRecipients(
        broadcast.id,
        ctx.accountId,
        ctx.userId
      ).catch((err) =>
        console.error('[Broadcast Background Send] error:', err)
      );
    }

    return NextResponse.json({
      success: true,
      broadcastId: broadcast.id,
      recipientsCount: contacts.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
