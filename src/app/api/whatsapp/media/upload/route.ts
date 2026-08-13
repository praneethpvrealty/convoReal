// ============================================================
// POST /api/whatsapp/media/upload — stage an attachment for a send.
//
// multipart/form-data with a single `file`. Returns the bucket-relative
// storage path, which the caller hands straight back to
// /api/whatsapp/send as `media_url`.
//
// Two steps rather than one multipart send, because a send can fail for
// reasons that have nothing to do with the file (a closed 24-hour
// window, a Meta outage) and re-uploading a 16 MB video over a phone
// connection to retry is not something to ask an agent to do twice.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { uploadChatMedia } from '@/lib/storage/upload';
import { mediaKindForMime, rejectMedia } from '@/lib/whatsapp/media-kinds';

export async function POST(request: Request) {
  // Outside the try below, whose catch reports failures as upload
  // errors. Attaching is 'agent' work, same gate as sending.
  let accountId: string;
  let userId: string;
  try {
    ({ accountId, userId } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const limit = await checkRateLimit(`media-upload:${userId}`, {
      limit: 30,
      windowMs: 60_000,
    });
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const form = await request.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        { error: 'Expected multipart/form-data' },
        { status: 400 },
      );
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // The recorder on mobile sends the codec parameter along; the kind
    // resolver strips it, and Meta is told the bare type.
    const mimeType = file.type || 'application/octet-stream';
    const rejection = rejectMedia(mimeType, file.size);
    if (rejection) {
      return NextResponse.json(
        { error: rejection.error, code: rejection.code },
        { status: 415 },
      );
    }

    const kind = mediaKindForMime(mimeType)!;
    const buffer = Buffer.from(await file.arrayBuffer());
    const path = await uploadChatMedia(
      accountId,
      buffer,
      mimeType.split(';')[0].trim(),
      file.name || undefined,
    );

    return NextResponse.json({
      data: {
        media_url: path,
        media_kind: kind,
        filename: file.name || null,
        mime_type: mimeType,
        size: file.size,
      },
    });
  } catch (error) {
    console.error('[whatsapp/media/upload] failed:', error);
    return NextResponse.json(
      { error: 'Could not upload the attachment' },
      { status: 500 },
    );
  }
}
