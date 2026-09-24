import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

// DELETE /api/admin/ai-keys/[id]/topups/[topupId]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; topupId: string }> }
) {
  try {
    await requirePlatformAdmin();
    const { id, topupId } = await params;
    const { error } = await supabaseAdmin()
      .from('ai_key_topups')
      .delete()
      .eq('id', topupId)
      .eq('key_id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: { id: topupId } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
