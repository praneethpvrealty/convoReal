// ============================================================
// POST /api/deals/[id]/documents/upload-url — stage a deal document.
//
// Body: { filename, mime_type, size }. Returns a one-shot Supabase
// Storage URL to PUT the bytes to, plus the bucket-relative path to
// hand back to POST /api/deals/[id]/documents, which files the row.
//
// The file itself never passes through this route. A serverless
// function rejects a request body over 4.5 MB at the edge, an eleventh
// of what this folder accepts, so the bytes go to storage directly and
// only the decision is made here.
// ============================================================

import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { DEAL_DOCUMENT_MIME_TYPES } from '@/lib/invoices/types';
import { DOCUMENT_SIZE_LIMIT } from '@/lib/inventory/documents';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { signDealDocumentUpload } from '@/lib/storage/deal-documents';

const ALLOWED_MIME_TYPES: readonly string[] = DEAL_DOCUMENT_MIME_TYPES;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `dealDocUpload:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: deal } = await ctx.supabase
      .from('deals')
      .select('id')
      .eq('id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const filename =
      typeof body?.filename === 'string' && body.filename.trim()
        ? body.filename.trim()
        : undefined;
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

    if (size > DOCUMENT_SIZE_LIMIT) {
      const mb = Math.round(DOCUMENT_SIZE_LIMIT / (1024 * 1024));
      return NextResponse.json(
        {
          error: `That file is over the ${mb} MB limit.`,
          code: 'FILE_TOO_LARGE',
        },
        { status: 413 }
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        {
          error:
            'Upload a PDF, a photo (JPEG, PNG, WebP or HEIC), or a Word or Excel file.',
          code: 'UNSUPPORTED_TYPE',
        },
        { status: 415 }
      );
    }

    const { uploadUrl, storagePath } = await signDealDocumentUpload(
      ctx.accountId,
      dealId,
      filename
    );

    return NextResponse.json({
      data: {
        upload_url: uploadUrl,
        storage_path: storagePath,
        mime_type: mimeType,
        size,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
