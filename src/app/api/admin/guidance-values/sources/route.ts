import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { SOURCE_MAX_BYTES } from '@/lib/guidance-value/import-url';
import {
  GUIDANCE_SOURCE_BUCKET,
  SOURCE_COLUMNS,
  requireGuidanceAdmin,
} from '@/lib/guidance-value/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

function text(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

// GET /api/admin/guidance-values/sources
export async function GET() {
  try {
    await requireGuidanceAdmin();
    const { data, error } = await supabaseAdmin()
      .from('guidance_value_sources')
      .select(SOURCE_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/admin/guidance-values/sources
//
// Registers a notification and returns a signed URL the browser PUTs the
// PDF to; parsing starts from /[id]/parse once the upload lands.
export async function POST(request: Request) {
  try {
    const { userId } = await requireGuidanceAdmin();
    const limit = await checkRateLimit(
      `guidanceSource:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const district = text(body?.district);
    const title = text(body?.title, 200);
    const size = Number(body?.size);
    const pageCount = Number(body?.page_count);
    const effectiveFrom = text(body?.effective_from, 10);

    if (!district || !title) {
      return NextResponse.json(
        { error: 'District and title are required' },
        { status: 400 }
      );
    }
    if (body?.mime_type !== 'application/pdf') {
      return NextResponse.json(
        {
          error: 'Upload the notification as a PDF.',
          code: 'UNSUPPORTED_TYPE',
        },
        { status: 415 }
      );
    }
    if (!Number.isFinite(size) || size <= 0 || size > SOURCE_MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            'The PDF must be under 14 MB. Split a larger notification by taluk or SRO.',
          code: 'FILE_TOO_LARGE',
        },
        { status: 413 }
      );
    }

    const safeName = (text(body?.filename, 120) ?? 'notification.pdf').replace(
      /[^a-zA-Z0-9.\-_]/g,
      '_'
    );
    const storagePath = `KA/${Date.now()}-${safeName}`;
    const db = supabaseAdmin();

    const { data: signed, error: signError } = await db.storage
      .from(GUIDANCE_SOURCE_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (signError || !signed) {
      throw new Error(signError?.message ?? 'Could not sign the upload');
    }

    const { data, error } = await db
      .from('guidance_value_sources')
      .insert({
        district,
        taluk: text(body?.taluk),
        sro: text(body?.sro),
        title,
        effective_from:
          effectiveFrom && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
            ? effectiveFrom
            : null,
        page_count:
          Number.isInteger(pageCount) && pageCount > 0 && pageCount < 5000
            ? pageCount
            : null,
        storage_path: storagePath,
        uploaded_by: userId,
      })
      .select(SOURCE_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { data: { source: data, upload_url: signed.signedUrl } },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
