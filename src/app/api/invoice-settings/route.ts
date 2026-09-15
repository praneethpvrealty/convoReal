import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getOrCreateInvoiceSettings } from '@/lib/invoices/server';
import { normaliseStateCode, stateNameForCode } from '@/lib/invoices/gst';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// GET /api/invoice-settings — the account's letterhead, tax posture and
// numbering policy. Readable by any member because every agent raising
// an invoice needs to see what it will print.
export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const settings = await getOrCreateInvoiceSettings(
      ctx.supabase,
      ctx.accountId
    );
    return NextResponse.json({ data: settings });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Only these may be written; anything else in the body is ignored.
 *  `signature_image_path` is deliberately absent: it is set only by the
 *  upload route, which namespaces the object under the account. Taking
 *  it as a free string here would let an admin point their letterhead at
 *  any object in the shared signatures bucket. */
const TEXT_FIELDS = [
  'legal_name',
  'rera_number',
  'pan',
  'gstin',
  'state_code',
  'default_sac',
  'default_particulars',
  'gst_note',
  'bank_account_name',
  'bank_name',
  'bank_account_number',
  'bank_ifsc',
  'signatory_label',
  'terms',
  'signatory_name',
  'signatory_designation',
  'signature_place',
  'number_prefix',
] as const;

const GST_MODES = ['nil', 'intra', 'inter'];
// 'dsc' and 'esign' are accepted so an account can be provisioned ahead
// of a certificate, but both need a provider that is not wired yet —
// see docs/invoice-digital-signature.md.
const SIGNATURE_MODES = ['none', 'image', 'dsc', 'esign'];

// PUT /api/invoice-settings — admin and above. PAN and bank details
// decide where money is asked to be sent, so this is deliberately a
// higher bar than raising an invoice.
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = await checkRateLimit(
      `invoiceSettings:${ctx.userId}`,
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

    await getOrCreateInvoiceSettings(ctx.supabase, ctx.accountId);

    const update: Record<string, unknown> = {};

    for (const field of TEXT_FIELDS) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null) {
        update[field] = null;
      } else if (typeof value === 'string') {
        update[field] = value.trim().slice(0, 500);
      }
    }

    if (Array.isArray(body.address_lines)) {
      update.address_lines = body.address_lines
        .filter((line: unknown): line is string => typeof line === 'string')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .slice(0, 6);
    }

    if ('gst_mode' in body) {
      if (!GST_MODES.includes(body.gst_mode)) {
        return NextResponse.json(
          { error: 'Invalid GST mode' },
          { status: 400 }
        );
      }
      update.gst_mode = body.gst_mode;
    }

    if ('signature_mode' in body) {
      if (!SIGNATURE_MODES.includes(body.signature_mode)) {
        return NextResponse.json(
          { error: 'Invalid signature mode' },
          { status: 400 }
        );
      }
      update.signature_mode = body.signature_mode;
    }

    if ('gst_rate' in body) {
      const rate = Number(body.gst_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return NextResponse.json(
          { error: 'GST rate must be between 0 and 100' },
          { status: 400 }
        );
      }
      update.gst_rate = rate;
    }

    if ('default_share_percent' in body) {
      const share = Number(body.default_share_percent);
      if (!Number.isFinite(share) || share <= 0 || share > 100) {
        return NextResponse.json(
          { error: 'Default share must be between 1 and 100' },
          { status: 400 }
        );
      }
      update.default_share_percent = share;
    }

    if ('starting_number' in body) {
      const start = Number(body.starting_number);
      if (!Number.isInteger(start) || start < 1) {
        return NextResponse.json(
          { error: 'Starting number must be a positive whole number' },
          { status: 400 }
        );
      }
      update.starting_number = start;
    }

    if ('number_resets_yearly' in body) {
      update.number_resets_yearly = Boolean(body.number_resets_yearly);
    }

    // The state code is the statutory input; the name is only what gets
    // printed, so it is derived rather than accepted, and the two can
    // never disagree on an invoice.
    if ('state_code' in update) {
      const code = normaliseStateCode(update.state_code as string);
      update.state_code = code || null;
      update.state_name = code ? stateNameForCode(code) : null;
    }

    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('invoice_settings')
      .update(update)
      .eq('account_id', ctx.accountId)
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
