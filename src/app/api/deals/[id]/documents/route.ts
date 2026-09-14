import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { DEAL_DOCUMENT_BUCKET } from '@/lib/invoices/server';
import { DEAL_DOCUMENT_CATEGORIES } from '@/lib/invoices/types';
import { DOCUMENT_SIZE_LIMIT } from '@/lib/inventory/documents';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

const CATEGORIES = DEAL_DOCUMENT_CATEGORIES.map((c) => c.value) as string[];

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

// GET /api/deals/[id]/documents — the deal's folder.
//
// Returns rows only, never URLs: each file is fetched through the
// per-document route, which checks membership and signs a short-lived
// link. A listing that handed out URLs would put an Aadhaar behind
// nothing but a guess.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const { data, error } = await ctx.supabase
      .from('deal_documents')
      .select('*')
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/deals/[id]/documents — upload a file into the deal folder.
// multipart/form-data: file, category, title?, contact_id?
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
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

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (file.size > DOCUMENT_SIZE_LIMIT) {
      const mb = Math.round(DOCUMENT_SIZE_LIMIT / (1024 * 1024));
      return NextResponse.json(
        {
          error: `That file is over the ${mb} MB limit.`,
          code: 'FILE_TOO_LARGE',
        },
        { status: 413 }
      );
    }

    const mimeType = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        {
          error: 'Upload a PDF or a photo (JPEG, PNG, WebP or HEIC).',
          code: 'UNSUPPORTED_TYPE',
        },
        { status: 415 }
      );
    }

    const category = String(form.get('category') ?? 'other');
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
    }

    const contactId = form.get('contact_id');
    const title =
      String(form.get('title') ?? '')
        .trim()
        .slice(0, 200) ||
      file.name ||
      'Document';

    // Namespaced by account and deal so one deal's papers cannot be
    // reached by guessing at another's, even if a signed URL leaks.
    const safeName = (file.name || 'document')
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .slice(-80);
    const objectPath = `${ctx.accountId}/${dealId}/${Date.now()}-${safeName}`;

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

    const { data, error } = await ctx.supabase
      .from('deal_documents')
      .insert({
        account_id: ctx.accountId,
        deal_id: dealId,
        contact_id:
          typeof contactId === 'string' && contactId ? contactId : null,
        category,
        title,
        storage_path: `${DEAL_DOCUMENT_BUCKET}/${objectPath}`,
        mime_type: mimeType,
        size_bytes: file.size,
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

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
