import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { DEAL_DOCUMENT_BUCKET, signedUrlFor } from '@/lib/invoices/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

// GET /api/deals/[id]/documents/[docId]
//
// The only way to read a deal document. The bucket is private, so this
// proves account membership through RLS first and only then signs a
// short-lived URL — the same shape as the call-recording route. An
// Aadhaar must never be reachable by URL alone.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId, docId } = await params;

    const { data: doc } = await ctx.supabase
      .from('deal_documents')
      .select('storage_path')
      .eq('id', docId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!doc?.storage_path) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }
    // Defence in depth: a row whose path points outside the private
    // bucket must not be signed, whatever put it there.
    if (!doc.storage_path.startsWith(`${DEAL_DOCUMENT_BUCKET}/`)) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    const url = await signedUrlFor(DEAL_DOCUMENT_BUCKET, doc.storage_path);
    if (!url) {
      return NextResponse.json(
        { error: 'Document unavailable' },
        { status: 404 }
      );
    }

    return NextResponse.redirect(url);
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/deals/[id]/documents/[docId]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId, docId } = await params;

    const { data: doc } = await ctx.supabase
      .from('deal_documents')
      .select('id, storage_path')
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

    const { data: removed, error } = await ctx.supabase
      .from('deal_documents')
      .delete()
      .eq('id', docId)
      .eq('account_id', ctx.accountId)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!removed?.length) {
      return NextResponse.json(
        { error: 'You do not have permission to delete this document.' },
        { status: 403 }
      );
    }

    // The row is the index; a file left behind would be unreachable but
    // still stored, and these are identity documents.
    if (doc.storage_path?.startsWith(`${DEAL_DOCUMENT_BUCKET}/`)) {
      await supabaseAdmin()
        .storage.from(DEAL_DOCUMENT_BUCKET)
        .remove([doc.storage_path.slice(DEAL_DOCUMENT_BUCKET.length + 1)]);
    }

    return NextResponse.json({ data: { id: docId } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
