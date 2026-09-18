import { NextResponse } from 'next/server';

import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  canDeleteDocument,
  canTransitionDocumentStatus,
  DEAL_DOCUMENT_STATUS_LABELS,
  parseDocumentPatch,
  type DealDocumentStatus,
} from '@/lib/deals/documents';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import { actorName } from '@/lib/deals/server';
import { DEAL_DOCUMENT_BUCKET, signedUrlFor } from '@/lib/invoices/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

// GET /api/deals/[id]/documents/[docId]
//
// The only way to read a deal document. The bucket is private, so this
// proves account membership through RLS first and only then signs a
// short-lived URL — the same shape as the call-recording route. An
// Aadhaar must never be reachable by URL alone.
export async function GET(
  request: Request,
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

    // A browser follows the redirect straight from an anchor. The mobile
    // app cannot: its request carries a bearer token, and Linking needs
    // a URL it can hand to the OS, so it asks for the link itself.
    if (new URL(request.url).searchParams.get('format') === 'json') {
      return NextResponse.json({ data: { url } });
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
    const ctx = await requireWriteRole('agent');
    const { id: dealId, docId } = await params;

    const { data: doc } = await ctx.supabase
      .from('deal_documents')
      .select('id, storage_path, status, superseded_by')
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

    // An approved or executed paper is superseded, never deleted — the
    // folder must not silently lose the version somebody signed.
    if (
      !canDeleteDocument({
        status: (doc.status as DealDocumentStatus | null) ?? null,
        superseded_by: doc.superseded_by ?? null,
      })
    ) {
      return NextResponse.json(
        {
          error:
            'This document is approved or executed. Upload the newer version and mark this one superseded instead.',
          code: 'DOCUMENT_LOCKED',
        },
        { status: 409 }
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

// PATCH /api/deals/[id]/documents/[docId] — lifecycle: a forward-only
// status, an expiry date, or the id of the document that supersedes
// this one. Every change is recorded on the deal timeline.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId, docId } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const parsed = parseDocumentPatch(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data: doc } = await ctx.supabase
      .from('deal_documents')
      .select('id, title, status, superseded_by')
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
    if (doc.superseded_by) {
      return NextResponse.json(
        { error: 'A superseded document cannot change.' },
        { status: 409 }
      );
    }

    const fromStatus = (doc.status as DealDocumentStatus | null) ?? null;
    const update: Record<string, unknown> = {};
    let replacingTitle: string | null = null;

    if (parsed.value.status !== undefined) {
      if (!canTransitionDocumentStatus(fromStatus, parsed.value.status)) {
        return NextResponse.json(
          { error: 'Document status only moves forward.' },
          { status: 409 }
        );
      }
      update.status = parsed.value.status;
    }
    if (parsed.value.expires_at !== undefined) {
      update.expires_at = parsed.value.expires_at;
    }
    if (parsed.value.superseded_by !== undefined) {
      if (parsed.value.superseded_by === docId) {
        return NextResponse.json(
          { error: 'A document cannot supersede itself.' },
          { status: 400 }
        );
      }
      const { data: newer } = await ctx.supabase
        .from('deal_documents')
        .select('id, title')
        .eq('id', parsed.value.superseded_by)
        .eq('deal_id', dealId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!newer) {
        return NextResponse.json(
          { error: 'The replacing document must be in this deal folder.' },
          { status: 404 }
        );
      }
      update.superseded_by = newer.id;
      update.superseded_at = new Date().toISOString();
      replacingTitle = newer.title;
    }

    const { data, error } = await ctx.supabase
      .from('deal_documents')
      .update(update)
      .eq('id', docId)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const name = await actorName(ctx.supabase, ctx.accountId, ctx.userId);
    const source = parseEventSource(body?.source);

    if (update.superseded_by) {
      await writeDealEvent({
        db: ctx.supabase,
        accountId: ctx.accountId,
        dealId,
        eventType: 'document_superseded',
        title: `${doc.title} superseded by ${replacingTitle ?? 'a newer version'}`,
        actorId: ctx.userId,
        actorName: name,
        source,
        metadata: {
          document_id: docId,
          superseded_by: update.superseded_by,
        },
      });
    }
    if (update.status !== undefined || update.expires_at !== undefined) {
      const to = update.status as DealDocumentStatus | undefined;
      await writeDealEvent({
        db: ctx.supabase,
        accountId: ctx.accountId,
        dealId,
        eventType: 'document_status_changed',
        title: to
          ? `${doc.title}: ${DEAL_DOCUMENT_STATUS_LABELS[to]}`
          : `${doc.title}: expiry ${update.expires_at ? `set to ${String(update.expires_at)}` : 'cleared'}`,
        actorId: ctx.userId,
        actorName: name,
        source,
        metadata: {
          document_id: docId,
          from_status: fromStatus,
          to_status: to ?? fromStatus,
          expires_at: data.expires_at ?? null,
        },
      });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
