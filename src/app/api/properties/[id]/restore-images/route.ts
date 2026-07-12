import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * POST /api/properties/[id]/restore-images
 *
 * Restores images that the cleanup lifecycle de-referenced (cleared from the
 * listing but kept in storage), by repopulating `properties.images` from the
 * latest `dereference` snapshot in image_cleanup_log. Only works before the
 * blobs are purged.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    // Tenant-scoped fetch — a forged id from another account resolves to null.
    const { data: property, error: propErr } = await ctx.supabase
      .from('properties')
      .select('id, images_cleanup_state')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (propErr) throw propErr;
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }
    if (property.images_cleanup_state === 'purged') {
      return NextResponse.json(
        { error: 'These photos were permanently deleted and cannot be restored.' },
        { status: 409 },
      );
    }
    if (property.images_cleanup_state !== 'dereferenced') {
      return NextResponse.json(
        { error: 'This property has no archived photos to restore.' },
        { status: 409 },
      );
    }

    const { data: snap, error: snapErr } = await ctx.supabase
      .from('image_cleanup_log')
      .select('snapshot')
      .eq('property_id', id)
      .eq('phase', 'dereference')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapErr) throw snapErr;

    const images = (snap?.snapshot as { images?: string[] } | null)?.images ?? [];
    if (images.length === 0) {
      return NextResponse.json(
        { error: 'No recoverable photo snapshot was found.' },
        { status: 409 },
      );
    }

    const { error: updateErr } = await ctx.supabase
      .from('properties')
      .update({
        images,
        images_cleanup_state: 'active',
        images_cleanup_warned_at: null,
        images_dereferenced_at: null,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (updateErr) throw updateErr;

    return NextResponse.json({ restored: images.length, images });
  } catch (err) {
    return toErrorResponse(err);
  }
}
