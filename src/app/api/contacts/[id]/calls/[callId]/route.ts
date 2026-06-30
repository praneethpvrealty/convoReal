import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// DELETE /api/contacts/[id]/calls/[callId]

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
