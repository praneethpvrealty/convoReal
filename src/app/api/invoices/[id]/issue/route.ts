import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  canTransition,
  logInvoiceEvent,
  renderInvoice,
  resolveSignatureImage,
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

    // Resolve the signature BEFORE issuing. An account can be in image
    // mode with nothing uploaded, or with an object that no longer
    // reads, and neither is a signature — stamping "Electronically
    // signed" on either is an assertion about a legal document that
    // nothing backs.
    const signatureImage = await resolveSignatureImage(invoice);
    const signedAt = signatureImage ? new Date().toISOString() : null;

    // Allocation and the draft→issued write happen inside one database
    // transaction, so the settings-row lock is still held when the
    // number is spent. Two agents pressing Issue together queue instead
    // of both reading the same MAX and colliding on the unique index.
    const { data: issued, error: issueError } = await ctx.supabase
      .rpc('issue_invoice', {
        p_invoice_id: id,
        p_signed_at: signedAt,
      })
      .single();

    if (issueError || !issued) {
      return NextResponse.json(
        {
          error:
            issueError?.message ?? 'This invoice was issued by someone else.',
          code: 'INVOICE_ALREADY_ISSUED',
        },
        { status: 409 }
      );
    }

    const numbered = issued as Invoice;

    // Hash what the customer will actually receive, so the stored hash
    // and the served document can be compared later. Written after the
    // number exists, because the number is on the page.
    const { hash } = await renderInvoice(numbered, { signatureImage });

    const { data, error } = await ctx.supabase
      .from('invoices')
      .update({ document_hash: hash })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logInvoiceEvent({
      accountId: ctx.accountId,
      invoiceId: id,
      event: 'issued',
      actorId: ctx.userId,
      request,
      documentHash: hash,
      metadata: {
        invoice_number: numbered.invoice_number,
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
