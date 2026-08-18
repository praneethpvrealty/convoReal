import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { rejectPropertyVideo } from '@/lib/inventory/property-video';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { uploadPropertyVideo } from '@/lib/storage/upload';
import { storageObjectPath } from '@/lib/storage/url';
import { queueYouTubeUploadIfConnected } from '@/lib/youtube/upload';

const VIDEO_FIELDS =
  'video_url, video_status, video_language, video_error, video_generated_at, youtube_video_id, youtube_status, youtube_error, youtube_uploaded_at';

async function removeOwnedVideo(accountId: string, value: string | null) {
  const objectPath = storageObjectPath(value);
  const prefix = `property-videos/${accountId}/`;
  if (!objectPath?.startsWith(prefix)) return;
  await supabaseAdmin()
    .storage.from('property-videos')
    .remove([objectPath.slice('property-videos/'.length)]);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole('agent');
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const limit = await checkRateLimit(`property-video-upload:${ctx.userId}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.success) return rateLimitResponse(limit);

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
    if (
      property.video_status === 'queued' ||
      property.video_status === 'processing'
    ) {
      return NextResponse.json(
        {
          error:
            'A video is being generated right now. Wait for it to finish before replacing it.',
        },
        { status: 409 }
      );
    }
    if (
      property.youtube_status === 'queued' ||
      property.youtube_status === 'uploading'
    ) {
      return NextResponse.json(
        {
          error:
            'This video is being uploaded to YouTube. Wait for it to finish before replacing it.',
        },
        { status: 409 }
      );
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No video provided.' },
        { status: 400 }
      );
    }

    const rejection = rejectPropertyVideo(file.type, file.size);
    if (rejection) {
      return NextResponse.json(
        { error: rejection.error, code: rejection.code },
        { status: rejection.status }
      );
    }

    const stored = await uploadPropertyVideo(
      ctx.accountId,
      Buffer.from(await file.arrayBuffer()),
      'video/mp4'
    );

    const { data: updated, error: updateError } = await ctx.supabase
      .from('properties')
      .update({
        video_url: stored,
        video_status: 'ready',
        video_language: null,
        video_error: null,
        video_generated_at: null,
        youtube_video_id: null,
        youtube_status: null,
        youtube_error: null,
        youtube_uploaded_at: null,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(VIDEO_FIELDS)
      .maybeSingle();

    if (updateError || !updated) {
      await removeOwnedVideo(ctx.accountId, stored).catch(() => undefined);
      if (updateError) throw updateError;
      return NextResponse.json(
        { error: 'Property not found, or you cannot change it.' },
        { status: 404 }
      );
    }

    if (property.video_url && property.video_url !== stored) {
      await removeOwnedVideo(ctx.accountId, property.video_url).catch(
        () => undefined
      );
    }

    await queueYouTubeUploadIfConnected(id, ctx.accountId);

    const { data: finalState } = await ctx.supabase
      .from('properties')
      .select(VIDEO_FIELDS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    return NextResponse.json({ data: finalState ?? updated });
  } catch (error) {
    console.error('[properties/video-upload] failed:', error);
    return NextResponse.json(
      { error: 'Could not upload the walkthrough video.' },
      { status: 500 }
    );
  }
}
