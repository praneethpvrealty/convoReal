import { NextResponse } from 'next/server';
import Redis from 'ioredis';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

/**
 * Queue a manual YouTube upload of a property's rendered listing
 * video. Free (no credits — the render already paid); the actual
 * upload runs in the queue worker, which pulls the MP4 from storage
 * and pushes it to the account's connected channel as Unlisted.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;

    const { data: property } = await ctx.supabase
      .from('properties')
      .select('id, video_url, video_status, youtube_status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found.' },
        { status: 404 }
      );
    }
    if (property.video_status !== 'ready' || !property.video_url) {
      return NextResponse.json(
        {
          error:
            'Generate the listing video first — the YouTube upload sends that video.',
        },
        { status: 400 }
      );
    }
    if (
      property.youtube_status === 'queued' ||
      property.youtube_status === 'uploading'
    ) {
      return NextResponse.json(
        { error: 'A YouTube upload is already in progress for this property.' },
        { status: 409 }
      );
    }

    const { data: config } = await supabaseAdmin()
      .from('youtube_config')
      .select('status')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (config?.status !== 'connected') {
      return NextResponse.json(
        { error: 'Connect a YouTube channel in Settings → Showcase first.' },
        { status: 400 }
      );
    }

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return NextResponse.json(
        {
          error:
            'YouTube uploads require the queue worker (REDIS_URL is not configured on this deployment).',
        },
        { status: 503 }
      );
    }

    await ctx.supabase
      .from('properties')
      .update({ youtube_status: 'queued', youtube_error: null })
      .eq('id', id);

    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    try {
      await redis.connect();
      await redis.rpush(
        'listing-videos',
        JSON.stringify({
          kind: 'youtube_upload',
          propertyId: id,
          accountId: ctx.accountId,
        })
      );
    } finally {
      redis.disconnect();
    }

    return NextResponse.json({ success: true, status: 'queued' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
