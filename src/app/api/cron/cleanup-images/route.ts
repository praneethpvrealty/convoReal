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

export async function GET() {
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

    // Clear the images array
    await supabase
      .from('properties')
      .update({ images: [] })
      .eq('id', prop.id);

    deletedCount++;
  }

  console.log(`[cleanup-images] deleted ${deletedCount} image sets, ${errorCount} errors, ${skippedCount} skipped`);

  return NextResponse.json({
    cleaned: deletedCount,
    errors: errorCount,
    skipped: skippedCount,
  });
}
