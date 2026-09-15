import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { canTransition, logInvoiceEvent } from '@/lib/invoices/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// POST /api/invoices/[id]/cancel
//
// Cancelling keeps the number. A gap in an invoice series is the first
// thing an auditor asks about, so the row stays with its number and a
// reason rather than being deleted — which is also why an issued
// invoice cannot be deleted at all.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `invoiceCancel:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) ?? {};
    const reason =
      typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

    const { data: existing } = await ctx.supabase
      .from('invoices')
      .select('id, status, invoice_number')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    if (!canTransition(existing.status, 'cancelled')) {
      return NextResponse.json(
        { error: 'This invoice is already cancelled.' },
        { status: 409 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('invoices')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason || null,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .neq('status', 'cancelled')
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logInvoiceEvent({
      accountId: ctx.accountId,
      invoiceId: id,
      event: 'cancelled',
      actorId: ctx.userId,
      request,
      metadata: { reason, invoice_number: existing.invoice_number },
    });

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
