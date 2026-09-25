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
// Valuations already saved keep their rate snapshot. With ?unread=1 it
// only removes a notification with no pages read and no batch, so a
// re-upload can never erase progress or orphan a queued batch.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireGuidanceAdmin();
    const { id } = await params;
    const unreadOnly = new URL(request.url).searchParams.get('unread') === '1';
    const db = supabaseAdmin();
    let query = db.from('guidance_value_sources').delete().eq('id', id);
    if (unreadOnly) query = query.eq('pages_parsed', 0).is('batch_id', null);
    const { data, error } = await query.select('storage_path');
    if (error) throw new Error(error.message);
    if (!data?.length) {
      return unreadOnly
        ? NextResponse.json(
            {
              error:
                'This notification has pages read or is in a batch, so it was kept.',
              code: 'SOURCE_IN_USE',
            },
            { status: 409 }
          )
        : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await db.storage
      .from(GUIDANCE_SOURCE_BUCKET)
      .remove([data[0].storage_path as string]);
    return NextResponse.json({ data: { id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
