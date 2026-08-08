// ============================================================
// GET    /api/whatsapp/groups/[groupId] — group + participants
// PATCH  /api/whatsapp/groups/[groupId] — subject/description, or
//        reset the invite link
// DELETE /api/whatsapp/groups/[groupId] — delete on WhatsApp
//
// Updates are confirmed by webhook, not by the response: Meta accepts
// the request and reports the result on group_settings_update. The row
// is written optimistically here and reconciled there.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  deleteGroup,
  removeParticipants,
  resetInviteLink,
  updateGroup,
} from '@/lib/whatsapp/groups-api';

async function loadGroup(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  groupId: string,
) {
  const { data } = await supabase
    .from('whatsapp_groups')
    .select('id, wa_group_id, subject, status')
    .eq('id', groupId)
    .eq('account_id', accountId)
    .maybeSingle();
  return data;
}

async function loadCredentials(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
) {
  const { data } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token, groups_enabled')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data?.groups_enabled) return null;
  return {
    phoneNumberId: data.phone_number_id as string,
    accessToken: decrypt(data.access_token),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  let accountId: string;
  try {
    ({ supabase, accountId } = await requireRole('viewer'));
  } catch (error) {
    return toErrorResponse(error);
  }

  const { groupId } = await params;
  const group = await loadGroup(supabase, accountId, groupId);
  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const { data: participants } = await supabase
    .from('whatsapp_group_participants')
    .select('id, wa_id, contact_id, joined_at, left_at, contact:contacts(id, name, phone)')
    .eq('group_id', groupId)
    .is('left_at', null)
    .order('joined_at', { ascending: true });

  return NextResponse.json({ data: { group, participants: participants ?? [] } });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  let accountId: string;
  try {
    ({ supabase, accountId } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const { groupId } = await params;
    const group = await loadGroup(supabase, accountId, groupId);
    if (!group?.wa_group_id) {
      return NextResponse.json(
        { error: 'Group not found, or still being created on WhatsApp' },
        { status: 404 },
      );
    }

    const credentials = await loadCredentials(supabase, accountId);
    if (!credentials) {
      return NextResponse.json(
        { error: 'Groups are not enabled for this number.' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => null);

    if (body?.action === 'reset_invite_link') {
      const inviteLink = await resetInviteLink(
        credentials.accessToken,
        group.wa_group_id,
      );
      const { data: rotated } = await supabase
        .from('whatsapp_groups')
        .update({ invite_link: inviteLink })
        .eq('id', groupId)
        .select('id');
      if (!rotated?.length) {
        // Meta already rotated the link, so the old one is dead either
        // way. Saying the write succeeded would leave the team handing
        // out a link the row still shows but nobody can join with.
        return NextResponse.json(
          {
            error:
              'WhatsApp rotated the link but it could not be saved — reopen the group to fetch the current one.',
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ data: { invite_link: inviteLink } });
    }

    if (body?.action === 'remove_participants') {
      const waIds = Array.isArray(body.wa_ids)
        ? body.wa_ids.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      if (waIds.length === 0) {
        return NextResponse.json(
          { error: 'wa_ids is required' },
          { status: 400 },
        );
      }
      await removeParticipants(credentials.accessToken, group.wa_group_id, waIds);
      // The participants webhook writes left_at; nothing is marked here
      // so a refusal Meta reports later cannot leave the row lying.
      return NextResponse.json({ data: { removed: waIds.length } });
    }

    const subject =
      typeof body?.subject === 'string' ? body.subject.trim() : undefined;
    const description =
      typeof body?.description === 'string' ? body.description.trim() : undefined;

    if (subject === undefined && description === undefined) {
      return NextResponse.json(
        { error: 'Nothing to update' },
        { status: 400 },
      );
    }

    await updateGroup(credentials.accessToken, group.wa_group_id, {
      subject,
      description,
    });

    const { data: updated } = await supabase
      .from('whatsapp_groups')
      .update({
        ...(subject !== undefined ? { subject } : {}),
        ...(description !== undefined ? { description } : {}),
      })
      .eq('id', groupId)
      .select('id');

    if (!updated?.length) {
      // Meta accepted the change; the settings webhook will reconcile
      // the row. Reporting success here would show the new subject
      // before it is stored and lose it on the next refresh.
      return NextResponse.json(
        {
          error:
            'WhatsApp accepted the change but it could not be saved locally — it will appear once WhatsApp confirms it.',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: { id: groupId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Meta error';
    console.error('[groups] PATCH failed:', message);
    return NextResponse.json(
      { error: `WhatsApp refused the change: ${message}` },
      { status: 502 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  let accountId: string;
  try {
    ({ supabase, accountId } = await requireRole('admin'));
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const { groupId } = await params;
    const group = await loadGroup(supabase, accountId, groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const credentials = await loadCredentials(supabase, accountId);
    if (!credentials) {
      return NextResponse.json(
        { error: 'Groups are not enabled for this number.' },
        { status: 400 },
      );
    }

    if (group.wa_group_id) {
      await deleteGroup(credentials.accessToken, group.wa_group_id);
    }

    // The lifecycle webhook marks it deleted. Doing it here as well
    // means a webhook that never arrives does not leave a group the
    // team believes is gone still listed as active.
    const { data: removed } = await supabase
      .from('whatsapp_groups')
      .update({ status: 'deleted' })
      .eq('id', groupId)
      .select('id');

    if (!removed?.length) {
      return NextResponse.json(
        {
          error:
            'The group was deleted on WhatsApp but is still listed here — the lifecycle webhook should clear it shortly.',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: { id: groupId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Meta error';
    console.error('[groups] DELETE failed:', message);
    return NextResponse.json(
      { error: `WhatsApp refused the deletion: ${message}` },
      { status: 502 },
    );
  }
}
