// ============================================================
// GET  /api/whatsapp/groups — this account's groups
// POST /api/whatsapp/groups — create one
//
// Creation is asynchronous on Meta's side: the POST answers with an
// invite link and a request id, and the real group id arrives later on
// the group_lifecycle_update webhook. The row is written as 'pending'
// and completed there, so the response here returns a shareable link
// for a group that cannot be messaged yet. Callers must not treat a
// 200 as "ready to send".
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { decrypt } from '@/lib/whatsapp/encryption';
import { createGroup } from '@/lib/whatsapp/groups-api';

export async function GET() {
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  let accountId: string;
  try {
    ({ supabase, accountId } = await requireRole('viewer'));
  } catch (error) {
    return toErrorResponse(error);
  }

  const { data, error } = await supabase
    .from('whatsapp_groups')
    .select(
      'id, wa_group_id, subject, description, invite_link, status, participant_count, error_message, created_at',
    )
    .eq('account_id', accountId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[groups] list failed:', error.message);
    return NextResponse.json({ error: 'Could not load groups' }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  let accountId: string;
  let userId: string;
  try {
    ({ supabase, accountId, userId } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const limit = checkRateLimit(`group-create:${userId}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
    const description =
      typeof body?.description === 'string' ? body.description.trim() : undefined;

    if (!subject) {
      return NextResponse.json({ error: 'subject is required' }, { status: 400 });
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token, groups_enabled')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      );
    }
    if (!config.groups_enabled) {
      // The Groups API is open to Official Business Accounts only. A
      // number that is not an OBA fails every groups call, so the gate
      // is explicit rather than letting Meta's error stand in for it.
      return NextResponse.json(
        {
          error:
            'Groups are not enabled for this number. The Groups API requires an Official Business Account — contact support once Meta has granted OBA status.',
          code: 'GROUPS_NOT_ENABLED',
        },
        { status: 400 },
      );
    }

    let created;
    try {
      created = await createGroup(
        {
          phoneNumberId: config.phone_number_id,
          accessToken: decrypt(config.access_token),
        },
        { subject, description },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Meta error';
      console.error('[groups] create failed:', message);
      return NextResponse.json(
        { error: `WhatsApp refused the group: ${message}` },
        { status: 502 },
      );
    }

    const { data: group, error: insertError } = await supabase
      .from('whatsapp_groups')
      .insert({
        account_id: accountId,
        subject,
        description: description || null,
        invite_link: created.inviteLink || null,
        request_id: created.requestId,
        status: 'pending',
        created_by: userId,
      })
      .select('id, subject, invite_link, status')
      .single();

    if (insertError) {
      // The group exists on WhatsApp; losing the row here means it is
      // orphaned rather than absent, which is worth saying plainly.
      console.error('[groups] created on Meta but insert failed:', insertError.message);
      return NextResponse.json(
        {
          error:
            'The group was created on WhatsApp but could not be recorded. Refresh in a moment — the webhook may still complete it.',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: {
        ...group,
        pending_reason:
          'WhatsApp confirms the group id asynchronously — the invite link works now, sending becomes available once it does.',
      },
    });
  } catch (error) {
    console.error('[groups] POST failed:', error);
    return NextResponse.json(
      { error: 'Could not create the group' },
      { status: 500 },
    );
  }
}
