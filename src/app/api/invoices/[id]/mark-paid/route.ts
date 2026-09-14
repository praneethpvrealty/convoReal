import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { canTransition, logInvoiceEvent } from '@/lib/invoices/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// POST /api/invoices/[id]/mark-paid
//
// Payment can land before the invoice was ever sent (a customer paying
// off the agreement), so this is reachable from `issued` as well as
// `sent` — see ALLOWED_TRANSITIONS.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `invoicePaid:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) ?? {};
    const paidAt =
      typeof body.paid_at === 'string' && body.paid_at
        ? new Date(body.paid_at)
        : new Date();

    if (Number.isNaN(paidAt.getTime())) {
      return NextResponse.json(
        { error: 'Invalid payment date' },
        { status: 400 }
      );
    }

    const { data: existing } = await ctx.supabase
      .from('invoices')
      .select('id, status, grand_total, invoice_number')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    if (!canTransition(existing.status, 'paid')) {
      return NextResponse.json(
        { error: `A ${existing.status} invoice cannot be marked paid.` },
        { status: 409 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: paidAt.toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .in('status', ['issued', 'sent'])
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logInvoiceEvent({
      accountId: ctx.accountId,
      invoiceId: id,
      event: 'paid',
      actorId: ctx.userId,
      request,
      metadata: {
        amount: existing.grand_total,
        invoice_number: existing.invoice_number,
      },
    });

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
