import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  extractDocumentFields,
  isExtractableMimeType,
} from '@/lib/invoices/document-extract';
import { DEAL_DOCUMENT_BUCKET } from '@/lib/invoices/server';
import type { DealDocumentCategory } from '@/lib/invoices/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

const FEATURE = 'deal_document_extract';
const COST = AI_FEATURE_COSTS[FEATURE];

// POST /api/deals/[id]/documents/[docId]/extract
//
// Read a document and PROPOSE fields. Nothing is written to the invoice
// here: the result lands on deal_documents.extracted and the agent
// applies it field by field. A misread digit in an address is then a
// correction, not a reissued invoice.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId, docId } = await params;

    const limit = await checkRateLimit(
      `dealDocExtract:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: doc } = await ctx.supabase
      .from('deal_documents')
      .select('id, storage_path, mime_type, category')
      .eq('id', docId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }
    if (!isExtractableMimeType(doc.mime_type)) {
      return NextResponse.json(
        {
          error: 'Only a PDF or a JPEG, PNG or WebP photo can be read.',
          code: 'UNSUPPORTED_TYPE',
        },
        { status: 415 }
      );
    }
    if (!doc.storage_path?.startsWith(`${DEAL_DOCUMENT_BUCKET}/`)) {
      return NextResponse.json(
        { error: 'Document unavailable' },
        { status: 404 }
      );
    }

    // Burned before the AI call, never after — the ordering the credit
    // engine requires. Refunded below if the read fails.
    const burn = await burnCredits(ctx.accountId, FEATURE, COST, {
      retryKey: `deal-doc-extract:${docId}`,
    });
    if (!burn.success) {
      return NextResponse.json(
        {
          error: `Not enough credits to read this document. ${burn.deficit} more needed.`,
          code: 'INSUFFICIENT_CREDITS',
        },
        { status: 402 }
      );
    }

    await ctx.supabase
      .from('deal_documents')
      .update({ extraction_status: 'pending', extraction_error: null })
      .eq('id', docId)
      .eq('account_id', ctx.accountId)
      .select('id');

    try {
      const { data: file, error: downloadError } = await supabaseAdmin()
        .storage.from(DEAL_DOCUMENT_BUCKET)
        .download(doc.storage_path.slice(DEAL_DOCUMENT_BUCKET.length + 1));

      if (downloadError || !file) {
        throw new Error(
          downloadError?.message ?? 'Could not read the stored file.'
        );
      }

      const extracted = await extractDocumentFields({
        buffer: new Uint8Array(await file.arrayBuffer()),
        mimeType: doc.mime_type as string,
        category: doc.category as DealDocumentCategory,
      });

      const { data, error } = await ctx.supabase
        .from('deal_documents')
        .update({
          extracted,
          extracted_at: new Date().toISOString(),
          extraction_status: 'done',
          extraction_error: null,
        })
        .eq('id', docId)
        .eq('account_id', ctx.accountId)
        .select('*')
        .single();

      if (error) throw new Error(error.message);

      return NextResponse.json({ data, credits: { spent: COST } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await refundCredits(ctx.accountId, FEATURE, COST, {
        description: 'deal document read failed',
      });

      await ctx.supabase
        .from('deal_documents')
        .update({
          extraction_status: 'failed',
          extraction_error: message.slice(0, 500),
        })
        .eq('id', docId)
        .eq('account_id', ctx.accountId)
        .select('id');

      console.error('[deal-document-extract] failed:', message);
      return NextResponse.json(
        { error: 'Could not read this document. Your credits were refunded.' },
        { status: 502 }
      );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
