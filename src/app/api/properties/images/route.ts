import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { uploadPropertyImage } from '@/lib/storage/upload';

const MAX_FILES_PER_REQUEST = 10;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

// POST /api/properties/images
//
// multipart/form-data with one or more `files`. Runs each photo through
// the shared Sharp pipeline (1200px, JPEG q75) so a camera original from
// the mobile editor is stored at the same size as a web or WhatsApp
// upload, and returns the bucket-relative paths for the caller to add to
// the listing.
export async function POST(request: Request) {
  try {
    const ctx = await requireWriteRole('agent');

    const limit = await checkRateLimit(`propertyImages:${ctx.userId}`, {
      limit: 30,
      windowMs: 60_000,
    });
    if (!limit.success) return rateLimitResponse(limit);

    const form = await request.formData().catch(() => null);
    const files = (form?.getAll('files') ?? []).filter(
      (f): f is File => f instanceof File
    );
    if (files.length === 0) {
      return NextResponse.json(
        { error: 'No photos provided' },
        { status: 400 }
      );
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Upload at most ${MAX_FILES_PER_REQUEST} photos at a time` },
        { status: 400 }
      );
    }
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        return NextResponse.json(
          { error: `${file.name || 'File'} is not an image` },
          { status: 415 }
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `${file.name || 'File'} is larger than 15 MB` },
          { status: 413 }
        );
      }
    }

    const paths: string[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      paths.push(await uploadPropertyImage(ctx.accountId, buffer, file.type));
    }
    return NextResponse.json({ data: { paths } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
