import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normaliseStateCode, stateNameForCode } from '@/lib/invoices/gst';
import { recalculate, repriceBrokerageLine } from '@/lib/invoices/prefill';
import { isEditable } from '@/lib/invoices/server';
import type { Invoice, InvoiceLineItem } from '@/lib/invoices/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// GET /api/invoices/[id] — one invoice with its audit trail.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id } = await params;

    const { data: invoice, error } = await ctx.supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const { data: events } = await ctx.supabase
      .from('invoice_events')
      .select('*')
      .eq('invoice_id', id)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    return NextResponse.json({ data: invoice, events: events ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/invoices/[id] — edit a draft.
//
// Only a draft. Once issued, the invoice is a record a customer may hold
// a copy of: the way to change it is to cancel and raise a new one, so
// the paper trail shows what happened rather than quietly disagreeing
// with what was sent.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `invoiceEdit:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

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
    if (!isEditable(existing.status)) {
      return NextResponse.json(
        {
          error: `This invoice is ${existing.status} and can no longer be edited. Cancel it and raise a new one.`,
          code: 'INVOICE_NOT_EDITABLE',
        },
        { status: 409 }
      );
    }

    const invoice = existing as Invoice;
    const update: Record<string, unknown> = {};

    if (typeof body.invoice_date === 'string' && body.invoice_date) {
      update.invoice_date = body.invoice_date.slice(0, 10);
    }
    if (typeof body.notes === 'string' || body.notes === null) {
      update.notes = body.notes ? String(body.notes).slice(0, 2000) : null;
    }
    if (['buyer', 'seller', 'both'].includes(body.side)) {
      update.side = body.side;
    }
    if (body.share_percent !== undefined) {
      const share = Number(body.share_percent);
      if (!Number.isFinite(share) || share <= 0 || share > 100) {
        return NextResponse.json(
          { error: 'Share must be between 1 and 100' },
          { status: 400 }
        );
      }
      update.share_percent = share;
    }
    if (body.bill_to && typeof body.bill_to === 'object') {
      update.bill_to = sanitiseBillTo(body.bill_to, invoice);
    }
    if (Array.isArray(body.line_items)) {
      update.line_items = sanitiseLineItems(body.line_items);
    }
    if (['nil', 'intra', 'inter'].includes(body.gst_mode)) {
      update.gst_mode = body.gst_mode;
    }
    if (body.gst_rate !== undefined) {
      const rate = Number(body.gst_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return NextResponse.json(
          { error: 'GST rate must be between 0 and 100' },
          { status: 400 }
        );
      }
      update.gst_rate = rate;
    }
    if ('place_of_supply_code' in body) {
      const code = normaliseStateCode(body.place_of_supply_code);
      update.place_of_supply_code = code || null;
      update.place_of_supply = code ? stateNameForCode(code) : null;
    }

    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // Changing the share has to change the money. The editor sends the
    // line items it was showing, which still hold the old share's
    // amount, so a bare merge would store "100%" next to a half-share
    // figure. The share is the higher-level control, so when it moves
    // the brokerage line is re-derived from the deal and wins over
    // whatever the client sent.
    const shareChanged =
      update.share_percent !== undefined &&
      Number(update.share_percent) !== Number(invoice.share_percent);

    if (shareChanged && invoice.deal_id) {
      const { data: deal } = await ctx.supabase
        .from('deals')
        .select('id, value, brokerage_type, brokerage_value')
        .eq('id', invoice.deal_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (deal) {
        update.line_items = repriceBrokerageLine(
          (update.line_items as InvoiceLineItem[]) ?? invoice.line_items ?? [],
          deal,
          Number(update.share_percent)
        );
      }
    }

    // Totals are never taken from the client. They are recomputed from
    // the line items and the tax posture, so a figure typed into a
    // request body cannot reach a customer's invoice.
    const merged = { ...invoice, ...update } as Invoice;
    Object.assign(
      update,
      recalculate({
        line_items: merged.line_items ?? [],
        gst_mode: merged.gst_mode,
        gst_rate: merged.gst_rate,
        issuer: merged.issuer,
        place_of_supply_code: merged.place_of_supply_code,
      })
    );

    const { data, error } = await ctx.supabase
      .from('invoices')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('status', 'draft')
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/invoices/[id] — discard a draft.
//
// Drafts only, and it is a real delete because a draft never had a
// number: nothing is missing from the series afterwards. An issued
// invoice is cancelled instead, which keeps its number standing.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data: existing } = await ctx.supabase
      .from('invoices')
      .select('id, status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    if (existing.status !== 'draft') {
      return NextResponse.json(
        {
          error:
            'Only a draft can be deleted. Cancel this invoice instead, so its number stays accounted for.',
          code: 'INVOICE_NOT_DELETABLE',
        },
        { status: 409 }
      );
    }

    const { data: removed, error } = await ctx.supabase
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('status', 'draft')
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!removed?.length) {
      return NextResponse.json(
        { error: 'This invoice was issued or removed by someone else.' },
        { status: 409 }
      );
    }

    return NextResponse.json({ data: { id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function sanitiseLineItems(items: unknown[]): InvoiceLineItem[] {
  return items
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object'
    )
    .slice(0, 20)
    .map((item, index) => ({
      sl_no: index + 1,
      sac: String(item.sac ?? '')
        .trim()
        .slice(0, 20),
      particulars: Array.isArray(item.particulars)
        ? item.particulars
            .filter((line: unknown): line is string => typeof line === 'string')
            .map((line: string) => line.trim())
            .filter(Boolean)
            .slice(0, 8)
        : [],
      taxable_value: Math.max(
        0,
        Number.isFinite(Number(item.taxable_value))
          ? Number(item.taxable_value)
          : 0
      ),
    }));
}

function sanitiseBillTo(input: Record<string, unknown>, invoice: Invoice) {
  const text = (value: unknown, max = 200) =>
    typeof value === 'string' ? value.trim().slice(0, max) || null : null;

  const code = normaliseStateCode(input.state_code as string);

  return {
    ...invoice.bill_to,
    name: text(input.name) ?? invoice.bill_to?.name ?? '',
    address_lines: Array.isArray(input.address_lines)
      ? input.address_lines
          .filter((line: unknown): line is string => typeof line === 'string')
          .map((line: string) => line.trim())
          .filter(Boolean)
          .slice(0, 6)
      : (invoice.bill_to?.address_lines ?? []),
    gstin: text(input.gstin, 20),
    pan: text(input.pan, 20),
    state_code: code || null,
    state_name: code ? stateNameForCode(code) : null,
    po_number: text(input.po_number, 60),
    po_date: text(input.po_date, 20),
    email: text(input.email, 200),
    phone: text(input.phone, 40),
  };
}
