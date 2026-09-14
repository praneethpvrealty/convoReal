import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  allocateInvoiceNumber,
  canTransition,
  logInvoiceEvent,
  renderInvoice,
} from '@/lib/invoices/server';
import type { Invoice } from '@/lib/invoices/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// POST /api/invoices/[id]/issue
//
// The point of no return: the draft takes a number out of the account's
// series, its snapshot stops being editable, and the rendered bytes are
// hashed so the record is tamper-evident from here on.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `invoiceIssue:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: existing, error: readError } = await ctx.supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (readError) {
      return NextResponse.json({ error: readError.message }, { status: 400 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    if (!canTransition(existing.status, 'issued')) {
      return NextResponse.json(
        {
          error: `This invoice is already ${existing.status}.`,
          code: 'INVOICE_ALREADY_ISSUED',
        },
        { status: 409 }
      );
    }

    const invoice = existing as Invoice;

    if (!invoice.issuer?.legal_name) {
      return NextResponse.json(
        {
          error:
            'Add your firm name and address in Settings before issuing an invoice.',
          code: 'INVOICE_SETTINGS_INCOMPLETE',
        },
        { status: 400 }
      );
    }
    if (!invoice.bill_to?.name) {
      return NextResponse.json(
        {
          error: 'The invoice needs a customer name.',
          code: 'BILL_TO_REQUIRED',
        },
        { status: 400 }
      );
    }
    if (!invoice.line_items?.length || invoice.grand_total <= 0) {
      return NextResponse.json(
        {
          error: 'The invoice needs at least one line with an amount.',
          code: 'LINE_ITEMS_REQUIRED',
        },
        { status: 400 }
      );
    }

    const allocation = await allocateInvoiceNumber(
      ctx.supabase,
      ctx.accountId,
      invoice.invoice_date
    );

    const issuedAt = new Date().toISOString();
    const numbered: Invoice = {
      ...invoice,
      invoice_number: allocation.invoiceNumber,
      sequence_number: allocation.sequenceNumber,
      financial_year: allocation.financialYear,
      status: 'issued',
      issued_at: issuedAt,
      // An image signature is applied at the moment of issue; a DSC or
      // eSign is applied afterwards by the provider, so those are not
      // marked signed here.
      signed_at: invoice.signature?.mode === 'image' ? issuedAt : null,
    };

    // Hash what the customer will actually receive, so the stored hash
    // and the served document can be compared later.
    const { hash } = await renderInvoice(numbered);

    const { data, error } = await ctx.supabase
      .from('invoices')
      .update({
        invoice_number: numbered.invoice_number,
        sequence_number: numbered.sequence_number,
        financial_year: numbered.financial_year,
        status: 'issued',
        issued_at: issuedAt,
        signed_at: numbered.signed_at,
        document_hash: hash,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      // Guards against two requests issuing the same draft: the second
      // matches no row, rather than overwriting the first one's number.
      .eq('status', 'draft')
      .select('*')
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'This invoice was issued by someone else.' },
        { status: 409 }
      );
    }

    await logInvoiceEvent({
      accountId: ctx.accountId,
      invoiceId: id,
      event: 'issued',
      actorId: ctx.userId,
      request,
      documentHash: hash,
      metadata: {
        invoice_number: allocation.invoiceNumber,
        grand_total: invoice.grand_total,
      },
    });

    if (numbered.signed_at) {
      await logInvoiceEvent({
        accountId: ctx.accountId,
        invoiceId: id,
        event: 'signed',
        actorId: ctx.userId,
        request,
        documentHash: hash,
        metadata: {
          mode: invoice.signature?.mode,
          signatory: invoice.signature?.signatory_name,
        },
      });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
