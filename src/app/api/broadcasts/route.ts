import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveAudienceOnServer, sendBroadcastRecipients } from '@/lib/broadcasts/sender';

const INSERT_BATCH_SIZE = 200;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    // Enforce per-user broadcast campaign start limit
    const limit = checkRateLimit(`broadcast:${ctx.userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { name, template, audience, variables } = body;

    if (!name || !template || !audience || !variables) {
      return NextResponse.json(
        { error: 'Missing required fields: name, template, audience, variables' },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();

    // 1. Resolve contacts server-side
    const contacts = await resolveAudienceOnServer(ctx.supabase, ctx.accountId, ctx.userId, audience);

    if (contacts.length === 0) {
      return NextResponse.json(
        { error: 'Audience is empty. No contacts matched the criteria.' },
        { status: 400 },
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
        audience_filter: audience,
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
      throw new Error(`Failed to create broadcast row: ${broadcastError?.message ?? 'unknown'}`);
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

        throw new Error(`Failed to insert recipient batch: ${recipientError.message}`);
      }
    }

    // 4. Trigger background dispatch in fire-and-forget style or via waitUntil
    if (typeof (request as any).waitUntil === 'function') {
      (request as any).waitUntil(
        sendBroadcastRecipients(broadcast.id, ctx.accountId, ctx.userId)
          .catch((err) => console.error('[Broadcast Background Send] error:', err))
      );
    } else {
      void sendBroadcastRecipients(broadcast.id, ctx.accountId, ctx.userId)
        .catch((err) => console.error('[Broadcast Background Send] error:', err));
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
