import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getPlanLimits } from '@/lib/billing/gates';
import type { Plan } from '@/lib/billing/types';
import {
  propertyVideoMaxBytes,
  propertyVideoMaxMegabytes,
  rejectPropertyVideo,
} from '@/lib/inventory/property-video';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { uploadPropertyVideo } from '@/lib/storage/upload';
import { storageObjectPath } from '@/lib/storage/url';
import { queueYouTubeUploadIfConnected } from '@/lib/youtube/upload';

const VIDEO_BUCKET = 'property-videos';
const VIDEO_FIELDS =
  'video_url, video_status, video_language, video_error, video_generated_at, youtube_video_id, youtube_status, youtube_error, youtube_uploaded_at';

type Context = Awaited<ReturnType<typeof requireRole>>;
type PropertyVideoState = {
  id: string;
  video_url: string | null;
  video_status: string | null;
  youtube_status: string | null;
};

async function removeOwnedVideo(accountId: string, value: string | null) {
  const objectPath = storageObjectPath(value);
  const prefix = `${VIDEO_BUCKET}/${accountId}/`;
  if (!objectPath?.startsWith(prefix)) return;
  await supabaseAdmin()
    .storage.from(VIDEO_BUCKET)
    .remove([objectPath.slice(`${VIDEO_BUCKET}/`.length)]);
}

async function loadProperty(
  ctx: Context,
  id: string
): Promise<PropertyVideoState | null> {
  const { data } = await ctx.supabase
    .from('properties')
    .select('id, video_url, video_status, youtube_status')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  return data as PropertyVideoState | null;
}

function busyResponse(property: PropertyVideoState): NextResponse | null {
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
  return null;
}

async function uploadLimit(ctx: Context) {
  const limits = await getPlanLimits(ctx);
  const maxBytes = propertyVideoMaxBytes(limits.plan as Plan);
  return {
    maxBytes,
    maxMegabytes: propertyVideoMaxMegabytes(maxBytes),
    plan: limits.plan as Plan,
  };
}

function resumableEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured)
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  const url = new URL(configured);
  const projectRef = url.hostname.match(/^([^.]+)\.supabase\.co$/)?.[1];
  if (projectRef) {
    return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

async function finalizeVideo(
  ctx: Context,
  property: PropertyVideoState,
  stored: string
) {
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
    .eq('id', property.id)
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

  await queueYouTubeUploadIfConnected(property.id, ctx.accountId);

  const { data: finalState } = await ctx.supabase
    .from('properties')
    .select(VIDEO_FIELDS)
    .eq('id', property.id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();

  return NextResponse.json({ data: finalState ?? updated });
}

async function authenticatedContext() {
  try {
    return { ctx: await requireRole('agent'), response: null };
  } catch (error) {
    return { ctx: null, response: toErrorResponse(error) };
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticatedContext();
  if (!auth.ctx) return auth.response;
  const { id } = await context.params;
  const property = await loadProperty(auth.ctx, id);
  if (!property) {
    return NextResponse.json({ error: 'Property not found.' }, { status: 404 });
  }
  return NextResponse.json(await uploadLimit(auth.ctx));
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticatedContext();
  if (!auth.ctx) return auth.response;
  const ctx = auth.ctx;

  try {
    const rate = await checkRateLimit(`property-video-session:${ctx.userId}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!rate.success) return rateLimitResponse(rate);

    const { id } = await context.params;
    const property = await loadProperty(ctx, id);
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found.' },
        { status: 404 }
      );
    }
    const busy = busyResponse(property);
    if (busy) return busy;

    const body = (await request.json().catch(() => null)) as {
      mimeType?: string;
      size?: number;
    } | null;
    const size = Number(body?.size);
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json(
        { error: 'Invalid video size.' },
        { status: 400 }
      );
    }

    const limit = await uploadLimit(ctx);
    const rejection = rejectPropertyVideo(body?.mimeType, size, limit.maxBytes);
    if (rejection) {
      return NextResponse.json(
        { error: rejection.error, code: rejection.code, ...limit },
        { status: rejection.status }
      );
    }

    const path = `${ctx.accountId}/wa-${Date.now()}-${randomUUID()}.mp4`;
    const { data, error } = await supabaseAdmin()
      .storage.from(VIDEO_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data?.token) {
      throw error ?? new Error('Storage did not create an upload token');
    }

    return NextResponse.json({
      data: {
        endpoint: resumableEndpoint(),
        path,
        token: data.token,
        maxBytes: limit.maxBytes,
      },
    });
  } catch (error) {
    console.error('[properties/video-upload/session] failed:', error);
    return NextResponse.json(
      { error: 'Could not start the walkthrough upload.' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticatedContext();
  if (!auth.ctx) return auth.response;
  const ctx = auth.ctx;

  try {
    const { id } = await context.params;
    const property = await loadProperty(ctx, id);
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found.' },
        { status: 404 }
      );
    }
    const busy = busyResponse(property);
    if (busy) return busy;

    const body = (await request.json().catch(() => null)) as {
      path?: string;
    } | null;
    const prefix = `${ctx.accountId}/`;
    const path = body?.path;
    if (!path?.startsWith(prefix) || path.slice(prefix.length).includes('/')) {
      return NextResponse.json(
        { error: 'Invalid video upload.' },
        { status: 400 }
      );
    }

    const filename = path.slice(prefix.length);
    const { data: objects, error: listError } = await supabaseAdmin()
      .storage.from(VIDEO_BUCKET)
      .list(ctx.accountId, { search: filename, limit: 10 });
    if (listError) throw listError;
    const object = objects?.find((candidate) => candidate.name === filename);
    const metadata = object?.metadata as
      { size?: number; mimetype?: string } | undefined;
    if (!object || !Number.isFinite(Number(metadata?.size))) {
      return NextResponse.json(
        { error: 'The uploaded video could not be verified.' },
        { status: 400 }
      );
    }

    const limit = await uploadLimit(ctx);
    const rejection = rejectPropertyVideo(
      metadata?.mimetype ?? 'video/mp4',
      Number(metadata?.size),
      limit.maxBytes
    );
    if (rejection) {
      await supabaseAdmin().storage.from(VIDEO_BUCKET).remove([path]);
      return NextResponse.json(
        { error: rejection.error, code: rejection.code },
        { status: rejection.status }
      );
    }

    return finalizeVideo(ctx, property, `${VIDEO_BUCKET}/${path}`);
  } catch (error) {
    console.error('[properties/video-upload/complete] failed:', error);
    return NextResponse.json(
      { error: 'Could not attach the walkthrough video.' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticatedContext();
  if (!auth.ctx) return auth.response;
  const ctx = auth.ctx;

  try {
    const limitResult = await checkRateLimit(
      `property-video-upload:${ctx.userId}`,
      { limit: 10, windowMs: 60_000 }
    );
    if (!limitResult.success) return rateLimitResponse(limitResult);

    const { id } = await context.params;
    const property = await loadProperty(ctx, id);
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found.' },
        { status: 404 }
      );
    }
    const busy = busyResponse(property);
    if (busy) return busy;

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No video provided.' },
        { status: 400 }
      );
    }

    const limit = await uploadLimit(ctx);
    const rejection = rejectPropertyVideo(file.type, file.size, limit.maxBytes);
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
    return finalizeVideo(ctx, property, stored);
  } catch (error) {
    console.error('[properties/video-upload] failed:', error);
    return NextResponse.json(
      { error: 'Could not upload the walkthrough video.' },
      { status: 500 }
    );
  }
}
