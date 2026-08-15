import { NextResponse } from 'next/server';
import Redis from 'ioredis';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isNarrationLanguage } from '@/lib/video/listing-video';

/**
 * Queue an auto-generated listing video for a property.
 *
 * Charges AI_FEATURE_COSTS.listing_video up front (refunded by the
 * worker if the render fails), stamps video_status='queued', and
 * pushes the job onto the 'listing-videos' Redis list consumed by
 * the queue worker — the only place ffmpeg/Sarvam run.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    let body: { language?: string } = {};
    try {
      body = await request.json();
    } catch {
      // empty body → default language
    }
    const language = isNarrationLanguage(body.language) ? body.language : 'en-IN';

    const { data: property } = await ctx.supabase
      .from('properties')
      .select('id, images, video_status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!property) {
      return NextResponse.json({ error: 'Property not found.' }, { status: 404 });
    }
    const photoCount = (property.images ?? []).filter((u: string) => u?.trim()).length;
    if (photoCount === 0) {
      return NextResponse.json(
        { error: 'Add at least one photo first — the video is built from the listing photos.' },
        { status: 400 },
      );
    }
    if (property.video_status === 'queued' || property.video_status === 'processing') {
      return NextResponse.json(
        { error: 'A video is already being generated for this property.' },
        { status: 409 },
      );
    }

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return NextResponse.json(
        { error: 'Video generation requires the queue worker (REDIS_URL is not configured on this deployment).' },
        { status: 503 },
      );
    }

    // Charge BEFORE the work is queued (credits-engine rule); the
    // worker refunds on failure.
    const cost = AI_FEATURE_COSTS.listing_video;
    const burn = await burnCredits(ctx.accountId, 'listing_video', cost);
    if (!burn.success) {
      return NextResponse.json(
        { error: `Not enough credits — generating a video costs ${cost} cr.`, deficit: burn.deficit },
        { status: 402 },
      );
    }

    // Claim the property before enqueueing: if the status write does not
    // land, the worker still picks the job up while the listing shows no
    // render in flight.
    const { data: queued } = await ctx.supabase
      .from('properties')
      .update({ video_status: 'queued', video_language: language, video_error: null })
      .eq('id', id)
      .select('id');

    if (!queued?.length) {
      return NextResponse.json(
        { error: 'Property not found, or you cannot change it' },
        { status: 404 },
      );
    }

    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
    try {
      await redis.connect();
      await redis.rpush(
        'listing-videos',
        JSON.stringify({
          kind: 'listing_video',
          propertyId: id,
          accountId: ctx.accountId,
          language,
          requestedBy: ctx.userId,
        }),
      );
    } finally {
      redis.disconnect();
    }

    return NextResponse.json({
      success: true,
      status: 'queued',
      language,
      cost,
      balanceAfter: burn.balanceAfter,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Remove a property's listing video: best-effort delete of the rendered
 * blob from the property-videos bucket, then clear the video_* columns
 * so the Showcase gallery stops playing it. YouTube copies are left
 * untouched — the unlisted link keeps working until re-uploaded.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    const { data: property } = await ctx.supabase
      .from('properties')
      .select('id, video_url, video_status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!property) {
      return NextResponse.json({ error: 'Property not found.' }, { status: 404 });
    }
    if (property.video_status === 'queued' || property.video_status === 'processing') {
      return NextResponse.json(
        { error: 'A video is being generated right now — wait for it to finish first.' },
        { status: 409 },
      );
    }
    if (!property.video_url && !property.video_status) {
      return NextResponse.json({ error: 'This property has no video.' }, { status: 404 });
    }

    // Storage deletes need the service role; the path's account prefix
    // (set by the render worker) must match the caller's tenant.
    const marker = '/object/public/property-videos/';
    const markerIdx = (property.video_url ?? '').indexOf(marker);
    if (markerIdx !== -1) {
      const storagePath = decodeURIComponent(
        property.video_url.slice(markerIdx + marker.length).split('?')[0],
      );
      if (storagePath.startsWith(`${ctx.accountId}/`)) {
        await supabaseAdmin().storage.from('property-videos').remove([storagePath]);
      }
    }

    const { data: cleared, error: updateErr } = await ctx.supabase
      .from('properties')
      .update({
        video_url: null,
        video_status: null,
        video_language: null,
        video_error: null,
        video_generated_at: null,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (updateErr) throw updateErr;
    if (!cleared?.length) {
      return NextResponse.json(
        { error: 'Property not found, or you cannot change it' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
