import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { buildPrefill, type PrefillContact } from '@/lib/invoices/prefill';
import {
  getOrCreateInvoiceSettings,
  logInvoiceEvent,
} from '@/lib/invoices/server';
import type { InvoiceSide } from '@/lib/invoices/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const SIDES: InvoiceSide[] = ['buyer', 'seller', 'both'];

// GET /api/deals/[id]/brokerage-invoices — every invoice raised from
// this deal.
//
// Note the path. `/api/deals/[id]/invoices` is a different feature that
// landed separately: it stores invoice FILES an agent uploads against a
// deal. These are invoices the Engine GENERATES from the deal, which is
// why they are records with a number and a status rather than objects in
// a bucket. The two are worth consolidating — see the note on the PR —
// but neither should silently take the other's endpoint.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const { data, error } = await ctx.supabase
      .from('invoices')
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

// POST /api/deals/[id]/brokerage-invoices — raise a draft, prefilled from the deal.
//
// The whole point of the feature: the response should be something the
// agent can issue without typing, so everything the Engine already knows
// is assembled here rather than asked for.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `invoiceCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) ?? {};

    const { data: deal, error: dealError } = await ctx.supabase
      .from('deals')
      .select(
        'id, title, value, currency, brokerage_type, brokerage_value, contact_id, property_id'
      )
      .eq('id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (dealError) {
      return NextResponse.json({ error: dealError.message }, { status: 400 });
    }
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const settings = await getOrCreateInvoiceSettings(
      ctx.supabase,
      ctx.accountId
    );

    const [property, contact, existingInvoices] = await Promise.all([
      deal.property_id
        ? ctx.supabase
            .from('properties')
            .select('title, unit_no, location, city, property_code')
            .eq('id', deal.property_id)
            .eq('account_id', ctx.accountId)
            .maybeSingle()
            .then(({ data }) => data)
        : Promise.resolve(null),
      deal.contact_id
        ? ctx.supabase
            .from('contacts')
            .select('salutation, name, second_name, email, phone')
            .eq('id', deal.contact_id)
            .eq('account_id', ctx.accountId)
            .maybeSingle()
            .then(({ data }) => data)
        : Promise.resolve(null),
      ctx.supabase
        .from('invoices')
        .select('side, share_percent, status')
        .eq('deal_id', dealId)
        .eq('account_id', ctx.accountId)
        .then(({ data }) => data ?? []),
    ]);

    // Joint buyers are one customer. `contact_parties` (migration 288)
    // already groups a husband and wife on one purchase, so the invoice
    // is addressed to the party rather than to whichever of them the
    // deal happens to point at.
    let partyId: string | null = null;
    let partyMembers: PrefillContact[] | null = null;
    if (deal.contact_id) {
      const { data: membership } = await ctx.supabase
        .from('contact_party_members')
        .select('party_id')
        .eq('contact_id', deal.contact_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (membership?.party_id) {
        partyId = membership.party_id;
        const { data: members } = await ctx.supabase
          .from('contact_party_members')
          .select(
            'contact:contacts(salutation, name, second_name, email, phone)'
          )
          .eq('party_id', membership.party_id)
          .eq('account_id', ctx.accountId);

        partyMembers =
          (members
            ?.map((row) => row.contact)
            .filter(Boolean) as unknown as PrefillContact[]) ?? null;
      }
    }

    // The customer's address is the one thing a CRM contact has never
    // held, so the last invoice raised to this same customer is the best
    // source for it.
    const { data: previousInvoice } = deal.contact_id
      ? await ctx.supabase
          .from('invoices')
          .select('bill_to, place_of_supply, place_of_supply_code')
          .eq('contact_id', deal.contact_id)
          .eq('account_id', ctx.accountId)
          .not('issued_at', 'is', null)
          .order('issued_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    const side: InvoiceSide | undefined = SIDES.includes(body.side)
      ? body.side
      : undefined;

    const sharePercent =
      body.share_percent !== undefined &&
      Number.isFinite(Number(body.share_percent))
        ? Math.min(Math.max(Number(body.share_percent), 0.01), 100)
        : undefined;

    const prefill = buildPrefill({
      deal,
      property,
      contact,
      partyMembers,
      settings,
      previousInvoice,
      existingInvoices,
      side,
      sharePercent,
      invoiceDate:
        typeof body.invoice_date === 'string' ? body.invoice_date : undefined,
    });

    const { data: invoice, error } = await ctx.supabase
      .from('invoices')
      .insert({
        ...prefill,
        account_id: ctx.accountId,
        deal_id: dealId,
        property_id: deal.property_id ?? null,
        contact_id: deal.contact_id ?? null,
        party_id: partyId,
        status: 'draft',
        signature: signatureFrom(settings),
        created_by: ctx.userId,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logInvoiceEvent({
      accountId: ctx.accountId,
      invoiceId: invoice.id,
      event: 'created',
      actorId: ctx.userId,
      request,
      metadata: { deal_id: dealId, side: invoice.side },
    });

    return NextResponse.json({ data: invoice }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** The signature block as configured today, copied onto the draft so a
 *  later settings change does not restate who signed this one. */
function signatureFrom(settings: {
  signature_mode: string;
  signatory_name: string | null;
  signatory_designation: string | null;
  signature_place: string | null;
  signature_image_path: string | null;
}) {
  return {
    mode: settings.signature_mode,
    signatory_name: settings.signatory_name,
    signatory_designation: settings.signatory_designation,
    place: settings.signature_place,
    image_path: settings.signature_image_path,
  };
}
