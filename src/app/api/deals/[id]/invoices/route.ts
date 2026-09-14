import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  INVOICE_BUCKET,
  INVOICE_URL_TTL_SECONDS,
  invoiceObjectPath,
  isOwnedInvoicePath,
  parseDealInvoices,
  rejectInvoiceFile,
  safeInvoiceFilename,
  type DealInvoice,
  type DealInvoiceLink,
} from '@/lib/pipelines/deal-invoices';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Brokerage paperwork for one deal.
 *
 * The bucket is private (migration 20260914114500), so nothing here returns an
 * object URL. Every read mints a short-lived signed link, and every
 * write resolves the deal through the caller's own RLS client first —
 * the service-role client only ever touches an object whose path is
 * already proven to sit under this account's deal.
 */

async function loadDeal(
  ctx: Awaited<ReturnType<typeof requireRole>>,
  dealId: string
): Promise<DealInvoice[] | null> {
  const { data } = await ctx.supabase
    .from('deals')
    .select('id, invoices')
    .eq('id', dealId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!data) return null;
  return parseDealInvoices(data.invoices);
}

async function withSignedUrls(
  invoices: DealInvoice[]
): Promise<DealInvoiceLink[]> {
  if (invoices.length === 0) return [];
  const { data } = await supabaseAdmin()
    .storage.from(INVOICE_BUCKET)
    .createSignedUrls(
      invoices.map((i) => i.path),
      INVOICE_URL_TTL_SECONDS
    );
  const byPath = new Map(
    (data ?? []).map((row) => [row.path ?? '', row.signedUrl ?? null])
  );
  return invoices.map((invoice) => ({
    ...invoice,
    url: byPath.get(invoice.path) ?? null,
  }));
}

async function persist(
  ctx: Awaited<ReturnType<typeof requireRole>>,
  dealId: string,
  invoices: DealInvoice[]
) {
  const { data, error } = await ctx.supabase
    .from('deals')
    .update({ invoices })
    .eq('id', dealId)
    .eq('account_id', ctx.accountId)
    .select('id');
  if (error) throw error;
  return Boolean(data?.length);
}

// GET /api/deals/[id]/invoices — list with freshly signed links.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

    const invoices = await loadDeal(ctx, dealId);
    if (!invoices) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    return NextResponse.json({ data: await withSignedUrls(invoices) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/deals/[id]/invoices — attach one invoice (multipart).
export async function POST(request: NextRequest, { params }: RouteParams) {
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  try {
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:dealInvoiceUpload:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const invoices = await loadDeal(ctx, dealId);
    if (!invoices) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const rejection = rejectInvoiceFile(file.type, file.size);
    if (rejection) {
      return NextResponse.json(
        { error: rejection.error, code: rejection.code },
        { status: rejection.status }
      );
    }

    const label = form?.get('name');
    const path = invoiceObjectPath(ctx.accountId, dealId, file.name);

    const { error: uploadErr } = await supabaseAdmin()
      .storage.from(INVOICE_BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      });
    if (uploadErr) {
      console.error('[POST /api/deals/[id]/invoices] Upload error:', uploadErr);
      return NextResponse.json(
        { error: 'Could not upload the invoice.' },
        { status: 500 }
      );
    }

    const entry: DealInvoice = {
      path,
      name:
        typeof label === 'string' && label.trim()
          ? label.trim().slice(0, 120)
          : safeInvoiceFilename(file.name),
      size: file.size,
      uploaded_at: new Date().toISOString(),
      uploaded_by: ctx.userId,
    };

    const next = [...invoices, entry];
    if (!(await persist(ctx, dealId, next))) {
      await supabaseAdmin()
        .storage.from(INVOICE_BUCKET)
        .remove([path])
        .catch(() => undefined);
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    return NextResponse.json(
      { data: await withSignedUrls(next) },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/deals/[id]/invoices] failed:', err);
    return NextResponse.json(
      { error: 'Could not upload the invoice.' },
      { status: 500 }
    );
  }
}

// DELETE /api/deals/[id]/invoices?path=... — detach one invoice.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:dealInvoiceDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const path = new URL(request.url).searchParams.get('path')?.trim() ?? '';
    if (!isOwnedInvoicePath(path, ctx.accountId, dealId)) {
      return NextResponse.json(
        { error: 'That invoice does not belong to this deal.' },
        { status: 400 }
      );
    }

    const invoices = await loadDeal(ctx, dealId);
    if (!invoices) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const next = invoices.filter((invoice) => invoice.path !== path);
    if (next.length === invoices.length) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (!(await persist(ctx, dealId, next))) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    // The row no longer points at it; a stray object is a cleanup line,
    // not a failed request.
    const { error: removeErr } = await supabaseAdmin()
      .storage.from(INVOICE_BUCKET)
      .remove([path]);
    if (removeErr) {
      console.warn(
        '[DELETE /api/deals/[id]/invoices] Object not removed:',
        path
      );
    }

    return NextResponse.json({ data: await withSignedUrls(next) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
