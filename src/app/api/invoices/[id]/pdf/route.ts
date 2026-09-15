import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { invoiceFilename } from '@/lib/invoices/pdf';
import { logInvoiceEvent, renderInvoice } from '@/lib/invoices/server';
import type { Invoice } from '@/lib/invoices/types';

// GET /api/invoices/[id]/pdf
//
// Rendered on demand from the frozen snapshot rather than served from
// storage, so what downloads can never have drifted from the record.
// The hash is compared on the way out: if the stored one and the freshly
// rendered one disagree, the snapshot has been altered since it was
// issued, and that is worth surfacing rather than quietly serving.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const invoice = data as Invoice;
    const { pdf, hash } = await renderInvoice(invoice);

    const tampered =
      Boolean(invoice.document_hash) && invoice.document_hash !== hash;
    if (tampered) {
      console.error(
        `[invoice ${id}] stored hash ${invoice.document_hash} does not match rendered ${hash}`
      );
    }

    if (invoice.status !== 'draft') {
      await logInvoiceEvent({
        accountId: ctx.accountId,
        invoiceId: id,
        event: 'downloaded',
        actorId: ctx.userId,
        request,
        documentHash: hash,
        metadata: tampered ? { hash_mismatch: true } : {},
      });
    }

    const disposition =
      new URL(request.url).searchParams.get('download') === '1'
        ? 'attachment'
        : 'inline';

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `${disposition}; filename="${invoiceFilename(invoice)}"`,
        // An invoice is account data and a draft changes as it is edited,
        // so no shared cache may hold on to either.
        'Cache-Control': 'private, no-store',
        ...(tampered ? { 'X-Invoice-Hash-Mismatch': '1' } : {}),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
