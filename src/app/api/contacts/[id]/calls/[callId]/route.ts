import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// PATCH  /api/contacts/[id]/calls/[callId] — edit notes / AI update
//        draft, or mark the update as sent by hand
// DELETE /api/contacts/[id]/calls/[callId]

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; callId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId, callId } = await params;

    const body = (await request.json().catch(() => null)) as {
      notes?: string | null;
      update_draft?: string | null;
      mark_sent?: boolean;
    } | null;

    const updates: Record<string, string | null> = {};
    if (body && 'notes' in body) {
      updates.notes = body.notes?.trim() || null;
    }
    if (body && 'update_draft' in body) {
      updates.update_draft = body.update_draft?.trim() || null;
    }
    // The agent sent the update from their own WhatsApp instead of the
    // Engine (the usual reason: the 24-hour window is shut). Only the
    // flag is accepted, never a caller-supplied timestamp, so the stamp
    // still means "the server saw this happen".
    if (body?.mark_sent) {
      updates.update_sent_at = new Date().toISOString();
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('contact_call_logs')
      .update(updates)
      .eq('id', callId)
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Call log not found' }, { status: 404 });
    }
    return NextResponse.json({ call: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; callId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId, callId } = await params;

    const { error } = await ctx.supabase
      .from('contact_call_logs')
      .delete()
      .eq('id', callId)
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId); // can only delete own logs

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
