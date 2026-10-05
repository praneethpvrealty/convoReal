import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { uploadPropertyImage } from '@/lib/storage/upload';
import { supabaseAdmin } from '@/lib/supabase/admin';

const BUCKET = 'property-images';
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

// POST /api/properties/images
//
// Body: { path: "property-images/<accountId>/..." } — a photo the caller
// has just uploaded straight to storage, which carries no request-size
// limit. The server runs it through the shared Sharp pipeline (1200px,
// JPEG q75), stores the result under a new path, removes the original and
// returns the new path, so a camera original from the mobile editor ends
// up the same size as a web or WhatsApp upload.
export async function POST(request: Request) {
  try {
    const ctx = await requireWriteRole('agent');

    const limit = await checkRateLimit(`propertyImages:${ctx.userId}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      path?: unknown;
    } | null;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    if (
      !path.startsWith(`${BUCKET}/${ctx.accountId}/`) ||
      path.includes('..')
    ) {
      return NextResponse.json(
        { error: 'Upload the photo first.' },
        { status: 400 }
      );
    }

    const objectPath = path.slice(BUCKET.length + 1);
    const storage = supabaseAdmin().storage.from(BUCKET);
    try {
      const { data: blob, error } = await storage.download(objectPath);
      if (error || !blob) {
        return NextResponse.json(
          { error: 'Photo not found. Upload it again.' },
          { status: 404 }
        );
      }
      if (!blob.type.startsWith('image/')) {
        return NextResponse.json(
          { error: 'Only photos can be added here.' },
          { status: 415 }
        );
      }
      if (blob.size > MAX_SOURCE_BYTES) {
        return NextResponse.json(
          { error: 'Photo is larger than 25 MB.' },
          { status: 413 }
        );
      }
      const resized = await uploadPropertyImage(
        ctx.accountId,
        Buffer.from(await blob.arrayBuffer()),
        blob.type
      );
      return NextResponse.json({ data: { path: resized } });
    } finally {
      await storage.remove([objectPath]);
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
