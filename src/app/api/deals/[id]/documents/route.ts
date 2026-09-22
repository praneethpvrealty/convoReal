import { NextResponse } from 'next/server';

import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import { actorName } from '@/lib/deals/server';
import { DEAL_DOCUMENT_BUCKET } from '@/lib/invoices/server';
import {
  DEAL_DOCUMENT_CATEGORIES,
  DEAL_DOCUMENT_MIME_TYPES,
} from '@/lib/invoices/types';
import { DOCUMENT_SIZE_LIMIT } from '@/lib/inventory/documents';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  dealDocumentObjectPath,
  stagedDealDocument,
} from '@/lib/storage/deal-documents';
import { supabaseAdmin } from '@/lib/supabase/admin';

const CATEGORIES = DEAL_DOCUMENT_CATEGORIES.map((c) => c.value) as string[];

const ALLOWED_MIME_TYPES: readonly string[] = DEAL_DOCUMENT_MIME_TYPES;

// GET /api/deals/[id]/documents — the deal's folder.
//
// Returns rows only, never URLs: each file is fetched through the
// per-document route, which checks membership and signs a short-lived
// link. A listing that handed out URLs would put an Aadhaar behind
// nothing but a guess.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const category = new URL(request.url).searchParams.get('category');
    if (category && !CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
    }

    let query = ctx.supabase
      .from('deal_documents')
      .select('*')
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId);

    if (category) query = query.eq('category', category);

    const { data, error } = await query.order('created_at', {
      ascending: false,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/deals/[id]/documents — file a document into the deal folder.
//
// JSON: { storage_path, category, title?, contact_id?, source? }, where
// storage_path is what /documents/upload-url signed and the client has
// already PUT the bytes to. The size and type on the row are read back
// from storage rather than taken from the caller, because the server no
// longer sees the file itself.
//
// multipart/form-data with a `file` part is the path clients shipped
// before the signed upload existed still take. It works up to the 4.5 MB
// a serverless function will accept, which is why it is not the one the
// app uses any more.
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

    const isJson = (request.headers.get('content-type') ?? '').includes(
      'application/json'
    );

    let objectPath: string;
    let mimeType: string;
    let sizeBytes: number;
    let filename: string;
    let category: string;
    let contactId: unknown;
    let title: string;
    let source: unknown;

    if (isJson) {
      const body = await request.json().catch(() => null);
      const storagePath = body?.storage_path;

      // The prefix proves the caller cannot name another account's — or
      // another deal's — file. It does not prove anything was written
      // there, so the object is read back below.
      if (
        typeof storagePath !== 'string' ||
        !storagePath.startsWith(
          `${DEAL_DOCUMENT_BUCKET}/${ctx.accountId}/${dealId}/`
        )
      ) {
        return NextResponse.json(
          { error: 'storage_path must be an upload staged for this deal' },
          { status: 400 }
        );
      }

      const staged = await stagedDealDocument(storagePath);
      if (!staged) {
        return NextResponse.json(
          { error: 'That upload did not finish — pick the file again.' },
          { status: 400 }
        );
      }

      objectPath = storagePath.slice(`${DEAL_DOCUMENT_BUCKET}/`.length);
      mimeType = staged.mimeType || 'application/octet-stream';
      sizeBytes = staged.size;
      filename = objectPath.split('/').pop() ?? 'Document';
      category = String(body?.category ?? 'other');
      contactId = body?.contact_id;
      title = String(body?.title ?? '')
        .trim()
        .slice(0, 200);
      source = body?.source;
    } else {
      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!form || !(file instanceof File)) {
        return NextResponse.json(
          { error: 'No file uploaded' },
          { status: 400 }
        );
      }

      objectPath = dealDocumentObjectPath(ctx.accountId, dealId, file.name);
      mimeType = file.type || 'application/octet-stream';
      sizeBytes = file.size;
      filename = file.name;
      category = String(form.get('category') ?? 'other');
      contactId = form.get('contact_id');
      title = String(form.get('title') ?? '')
        .trim()
        .slice(0, 200);
      source = form.get('source');

      if (
        sizeBytes <= DOCUMENT_SIZE_LIMIT &&
        ALLOWED_MIME_TYPES.includes(mimeType)
      ) {
        const { error: uploadError } = await supabaseAdmin()
          .storage.from(DEAL_DOCUMENT_BUCKET)
          .upload(objectPath, Buffer.from(await file.arrayBuffer()), {
            contentType: mimeType,
            upsert: false,
          });

        if (uploadError) {
          return NextResponse.json(
            { error: `Upload failed: ${uploadError.message}` },
            { status: 502 }
          );
        }
      }
    }

    // Checked against what actually landed, whichever way it got here,
    // so a client that declared one thing and stored another is refused
    // before the row records the lie.
    const refuse = async (payload: object, status: number) => {
      if (isJson) {
        await supabaseAdmin()
          .storage.from(DEAL_DOCUMENT_BUCKET)
          .remove([objectPath]);
      }
      return NextResponse.json(payload, { status });
    };

    if (sizeBytes > DOCUMENT_SIZE_LIMIT) {
      const mb = Math.round(DOCUMENT_SIZE_LIMIT / (1024 * 1024));
      return refuse(
        {
          error: `That file is over the ${mb} MB limit.`,
          code: 'FILE_TOO_LARGE',
        },
        413
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return refuse(
        {
          error:
            'Upload a PDF, a photo (JPEG, PNG, WebP or HEIC), or a Word or Excel file.',
          code: 'UNSUPPORTED_TYPE',
        },
        415
      );
    }

    if (!CATEGORIES.includes(category)) {
      return refuse({ error: 'Unknown category' }, 400);
    }

    const documentTitle = title || filename || 'Document';

    const { data, error } = await ctx.supabase
      .from('deal_documents')
      .insert({
        account_id: ctx.accountId,
        deal_id: dealId,
        contact_id:
          typeof contactId === 'string' && contactId ? contactId : null,
        category,
        title: documentTitle,
        storage_path: `${DEAL_DOCUMENT_BUCKET}/${objectPath}`,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        uploaded_by: ctx.userId,
      })
      .select('*')
      .single();

    if (error) {
      // Do not leave an orphan object behind if the row could not be written.
      await supabaseAdmin()
        .storage.from(DEAL_DOCUMENT_BUCKET)
        .remove([objectPath]);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'document_added',
      title: `Document added: ${documentTitle}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(source),
      metadata: { document_id: data.id, category, title: documentTitle },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
