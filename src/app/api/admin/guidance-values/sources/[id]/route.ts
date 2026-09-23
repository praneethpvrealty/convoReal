import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import {
  GUIDANCE_SOURCE_BUCKET,
  requireGuidanceAdmin,
} from '@/lib/guidance-value/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

// DELETE /api/admin/guidance-values/sources/[id]
//
// Removes the notification, its rates (cascade) and the stored PDF.
// Valuations already saved keep their rate snapshot.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireGuidanceAdmin();
    const { id } = await params;
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('guidance_value_sources')
      .delete()
      .eq('id', id)
      .select('storage_path');
    if (error) throw new Error(error.message);
    if (!data?.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await db.storage
      .from(GUIDANCE_SOURCE_BUCKET)
      .remove([data[0].storage_path as string]);
    return NextResponse.json({ data: { id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
