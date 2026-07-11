import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const DAYS_THRESHOLD = 90;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function extractPath(url: string): string | null {
  try {
    const u = new URL(url);
    const idx = u.pathname.indexOf('/public/property-images/');
    if (idx === -1) return null;
    return u.pathname.slice(idx + '/public/property-images/'.length);
  } catch {
    return null;
  }
}

/**
 * Deletes stored images for Sold / stale-unpublished properties on a
 * schedule. DESTRUCTIVE and cross-tenant, so it must never be
 * publicly triggerable.
 *
 * Auth: requires the shared cron secret, supplied either via the
 * repo-standard `x-cron-secret` header (external pinger, like the
 * other cron routes) or Vercel Cron's native `Authorization: Bearer`
 * header (this job is registered in vercel.json). Matched against
 * `AUTOMATION_CRON_SECRET` (the operator's existing cron secret) or
 * `CRON_SECRET` (Vercel's default var). Fails CLOSED: if no secret is
 * configured the endpoint returns 503 rather than running.
 */
export async function GET(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const cutoff = new Date(Date.now() - DAYS_THRESHOLD * 24 * 60 * 60 * 1000).toISOString();
  let deletedCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  // Target: properties with status 'Sold' OR unpublished properties stale > 90 days
  const { data: properties, error } = await supabase
    .from('properties')
    .select('id, images, status, is_published, updated_at')
    .or(`status.eq.Sold,and(is_published.eq.false,updated_at.lte.${cutoff})`)
    .not('images', 'is', null);

  if (error) {
    console.error('[cleanup-images] query error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const prop of (properties ?? [])) {
    const images = prop.images as string[];
    if (!images || images.length === 0) {
      skippedCount++;
      continue;
    }

    const paths = images.map(extractPath).filter(Boolean) as string[];

    if (paths.length > 0) {
      const { error } = await supabase.storage
        .from('property-images')
        .remove(paths);

      if (error) {
        console.error(`[cleanup-images] failed to delete images for ${prop.id}:`, error);
        errorCount++;
        continue;
      }
    }

    // Clear the images array. The blobs are already deleted above, so a
    // failed update leaves the row pointing at dead URLs — surface it as
    // an error instead of silently counting a clean success.
    const { error: updateError } = await supabase
      .from('properties')
      .update({ images: [] })
      .eq('id', prop.id);

    if (updateError) {
      console.error(
        `[cleanup-images] blobs removed but DB update failed for ${prop.id}:`,
        updateError,
      );
      errorCount++;
      continue;
    }

    deletedCount++;
  }

  console.log(`[cleanup-images] deleted ${deletedCount} image sets, ${errorCount} errors, ${skippedCount} skipped`);

  return NextResponse.json({
    cleaned: deletedCount,
    errors: errorCount,
    skipped: skippedCount,
  });
}
