// ============================================================
// POST /api/whatsapp/media/upload-url — stage an attachment for a send.
//
// Body: { filename, mime_type, size }. Returns a one-shot Supabase
// Storage URL to PUT the bytes to, plus the bucket-relative path the
// caller hands straight back to /api/whatsapp/send as `media_url`.
//
// The file itself never passes through this route. A serverless
// function rejects a request body over 4.5 MB at the edge, below every
// cap the composer offers, and the caller sees the connection drop
// rather than a refusal naming the limit — so the bytes go to storage
// directly and only the decision is made here.
//
// Two steps rather than one send, because a send can fail for reasons
// that have nothing to do with the file (a closed 24-hour window, a
// Meta outage) and re-uploading a 16 MB video over a phone connection
// to retry is not something to ask an agent to do twice.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { signChatMediaUpload } from '@/lib/storage/chat-media';
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

    const body = await request.json().catch(() => null);
    const filename =
      typeof body?.filename === 'string' && body.filename.trim()
        ? body.filename.trim()
        : undefined;
    // The recorder on mobile sends the codec parameter along; the kind
    // resolver strips it, and Meta is told the bare type.
    const mimeType =
      typeof body?.mime_type === 'string' && body.mime_type.trim()
        ? body.mime_type.trim()
        : 'application/octet-stream';
    const size = Number(body?.size);

    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json(
        { error: 'size must be the byte length of the file' },
        { status: 400 }
      );
    }

    const rejection = rejectMedia(mimeType, size);
    if (rejection) {
      return NextResponse.json(
        { error: rejection.error, code: rejection.code },
        { status: 415 }
      );
    }

    const bareMimeType = mimeType.split(';')[0].trim();
    const { uploadUrl, path } = await signChatMediaUpload(
      accountId,
      bareMimeType,
      filename
    );

    return NextResponse.json({
      data: {
        upload_url: uploadUrl,
        media_url: path,
        media_kind: mediaKindForMime(bareMimeType)!,
        filename: filename ?? null,
        mime_type: bareMimeType,
        size,
      },
    });
  } catch (error) {
    console.error('[whatsapp/media/upload-url] failed:', error);
    return NextResponse.json(
      { error: 'Could not stage the attachment' },
      { status: 500 }
    );
  }
}
