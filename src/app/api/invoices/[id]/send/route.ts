import { NextResponse } from 'next/server';

import {
  requireRole,
  toErrorResponse,
  type AccountContext,
} from '@/lib/auth/account';
import { sendTransactionalEmail } from '@/lib/email';
import { invoiceFilename } from '@/lib/invoices/pdf';
import {
  canTransition,
  INVOICE_BUCKET,
  logInvoiceEvent,
  renderInvoice,
  signedUrlFor,
  storeInvoicePdf,
} from '@/lib/invoices/server';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import type { Invoice } from '@/lib/invoices/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  CUSTOMER_WINDOW_EXPIRED_MESSAGE,
  isWithinCustomerWindow,
} from '@/lib/whatsapp/customer-window';
import { sendMediaMessage } from '@/lib/whatsapp/meta-api';

// POST /api/invoices/[id]/send — deliver the invoice to the customer.
//
// Body: { channel: 'whatsapp' | 'email', to?: string }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `invoiceSend:${ctx.userId}`,
      RATE_LIMITS.send
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) ?? {};
    const channel = body.channel === 'email' ? 'email' : 'whatsapp';

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

    // A draft has no number, so sending one would put a document in a
    // customer's hands that the series does not account for.
    if (invoice.status === 'draft') {
      return NextResponse.json(
        {
          error: 'Issue the invoice before sending it.',
          code: 'INVOICE_NOT_ISSUED',
        },
        { status: 409 }
      );
    }
    if (invoice.status === 'cancelled') {
      return NextResponse.json(
        { error: 'This invoice has been cancelled.' },
        { status: 409 }
      );
    }

    const { pdf, hash } = await renderInvoice(invoice);
    const filename = invoiceFilename(invoice);
    const amount = `Rs. ${formatIndianDigits(invoice.grand_total)}`;

    if (channel === 'email') {
      const to =
        (typeof body.to === 'string' && body.to.trim()) ||
        invoice.bill_to?.email;
      if (!to) {
        return NextResponse.json(
          { error: 'No email address for this customer.', code: 'NO_EMAIL' },
          { status: 400 }
        );
      }

      const result = await sendTransactionalEmail({
        to,
        subject:
          `Invoice ${invoice.invoice_number} from ${invoice.issuer?.legal_name ?? ''}`.trim(),
        html: emailBody(invoice, amount),
        text: `Please find attached invoice ${invoice.invoice_number} for ${amount}.`,
        attachments: [{ filename, content: Buffer.from(pdf) }],
      });

      if (!result.success) {
        return NextResponse.json(
          { error: result.error ?? 'Could not send the email.' },
          { status: 502 }
        );
      }

      await markSent(ctx, id, invoice, hash, request, 'email', to);
      return NextResponse.json({ data: { channel: 'email', to } });
    }

    // ---- WhatsApp ---------------------------------------------------
    const to =
      (typeof body.to === 'string' && body.to.trim()) || invoice.bill_to?.phone;
    if (!to) {
      return NextResponse.json(
        { error: 'No WhatsApp number for this customer.', code: 'NO_PHONE' },
        { status: 400 }
      );
    }

    const { data: config } = await ctx.supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp is not configured for this account.' },
        { status: 400 }
      );
    }

    // A document is free-form. Outside the 24-hour window Meta accepts
    // it, returns a wamid, then fails it asynchronously — so the invoice
    // would look sent and never arrive. A template cannot carry an
    // arbitrary PDF, so this is refused rather than swapped, matching
    // what /api/whatsapp/send does for media.
    const { data: lastInbound } = await ctx.supabase
      .from('messages')
      .select('created_at, conversation:conversations!inner(contact_id)')
      .eq('account_id', ctx.accountId)
      .eq('sender_type', 'customer')
      .eq('conversation.contact_id', invoice.contact_id ?? '')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      !isWithinCustomerWindow(lastInbound?.created_at ?? null) &&
      config.integration_type !== 'sandbox'
    ) {
      return NextResponse.json(
        {
          error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
          code: 'CUSTOMER_WINDOW_EXPIRED',
        },
        { status: 409 }
      );
    }

    // Stored in the private bucket and handed to Meta as a signed URL:
    // Meta fetches the link at send time, so the invoice never needs a
    // public object.
    const storagePath = await storeInvoicePdf(ctx.accountId, invoice.id, pdf);
    const link = await signedUrlFor(INVOICE_BUCKET, storagePath);
    if (!link) {
      return NextResponse.json(
        { error: 'Could not prepare the invoice for sending.' },
        { status: 502 }
      );
    }

    try {
      await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken: decrypt(config.access_token),
        to,
        kind: 'document',
        link,
        filename,
        caption:
          `Invoice ${invoice.invoice_number} for ${amount} from ${invoice.issuer?.legal_name ?? ''}`.trim(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    await ctx.supabase
      .from('invoices')
      .update({ pdf_path: storagePath })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id');

    await markSent(ctx, id, invoice, hash, request, 'whatsapp', to);
    return NextResponse.json({ data: { channel: 'whatsapp', to } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Record the delivery.
 *
 * `sent` is only set from `issued` — an invoice already marked paid does
 * not regress to sent because a copy was re-sent — but the audit event
 * is written either way, so "when did we last send this?" is always
 * answerable.
 */
async function markSent(
  ctx: AccountContext,
  id: string,
  invoice: Invoice,
  hash: string,
  request: Request,
  channel: string,
  to: string
): Promise<void> {
  if (canTransition(invoice.status, 'sent')) {
    await ctx.supabase
      .from('invoices')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('status', 'issued')
      .select('id');
  }

  await logInvoiceEvent({
    accountId: ctx.accountId,
    invoiceId: id,
    event: 'sent',
    actorId: ctx.userId,
    request,
    documentHash: hash,
    metadata: { channel, to, invoice_number: invoice.invoice_number },
  });
}

function emailBody(invoice: Invoice, amount: string): string {
  const escape = (value: string) =>
    value.replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`);

  return `
    <p>Dear ${escape(invoice.bill_to?.name ?? 'Sir/Madam')},</p>
    <p>Please find attached invoice <strong>${escape(invoice.invoice_number ?? '')}</strong>
       for <strong>${escape(amount)}</strong>.</p>
    <p>${escape(invoice.amount_in_words ?? '')}</p>
    <p>Regards,<br/>${escape(invoice.issuer?.legal_name ?? '')}</p>
  `.trim();
}
