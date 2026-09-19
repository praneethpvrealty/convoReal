import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  deleteNumberProfile,
  listNumberProfiles,
  renameNumberProfile,
  setNumberProfileAutoReply,
} from '@/lib/whatsapp/number-profiles';

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const data = await listNumberProfiles(ctx.supabase, ctx.accountId);
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => ({}))) as {
      id?: unknown;
      label?: unknown;
      auto_reply_enabled?: unknown;
      auto_reply_message?: unknown;
    };
    if (typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const touchesAutoReply =
      body.auto_reply_enabled !== undefined ||
      body.auto_reply_message !== undefined;
    if (!touchesAutoReply && body.label === undefined) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    let data =
      body.label !== undefined
        ? await renameNumberProfile(ctx.supabase, {
            accountId: ctx.accountId,
            profileId: body.id,
            label: body.label,
          })
        : null;
    if (touchesAutoReply) {
      data = await setNumberProfileAutoReply(ctx.supabase, {
        accountId: ctx.accountId,
        profileId: body.id,
        enabled: body.auto_reply_enabled,
        message: body.auto_reply_message,
      });
    }
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const id = new URL(request.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    await deleteNumberProfile(ctx.supabase, {
      accountId: ctx.accountId,
      profileId: id,
    });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
