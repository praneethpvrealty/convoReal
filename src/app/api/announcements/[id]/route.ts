import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// DELETE /api/announcements/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data: deleted, error } = await ctx.supabase
      .from('voice_announcements')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json(
        { error: 'Announcement not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ data: { id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
