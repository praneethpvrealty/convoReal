import { NextRequest, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logPropertyShare } from '@/lib/whatsapp/share-property-send';

// POST /api/properties/share-log
// Body: {
//   property_id: string,
//   recipients: Array<{ contact_id: string, classification?: string | null }>,
//   channel?: 'whatsapp' | 'email',
//   journey_visible?: boolean,
// }
//
// The share ledger for a send the app did not perform itself — a
// personal-WhatsApp hand-off, an email the agent sent from their own
// client, a broadcast the share sheet has already confirmed. One call
// records the share and captures the pair on the contact's journey,
// through the same server writer every in-app send uses, so a share
// surface cannot record half of it.

const MAX_RECIPIENTS = 500;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const body = (await request.json().catch(() => null)) as {
      property_id?: unknown;
      recipients?: unknown;
      channel?: unknown;
      journey_visible?: unknown;
    } | null;
    const propertyId =
      typeof body?.property_id === 'string' ? body.property_id.trim() : '';
    const recipients = Array.isArray(body?.recipients)
      ? (
          body.recipients as Array<{
            contact_id?: unknown;
            classification?: unknown;
          }>
        )
          .filter((r) => r && typeof r.contact_id === 'string')
          .map((r) => ({
            contactId: (r.contact_id as string).trim(),
            classification:
              typeof r.classification === 'string' ? r.classification : null,
          }))
          .filter((r) => r.contactId)
      : [];
    const channel = body?.channel === 'email' ? 'email' : 'whatsapp';
    const journeyVisible = body?.journey_visible === true;
    if (!propertyId || recipients.length === 0) {
      return NextResponse.json(
        { error: 'property_id and recipients are required' },
        { status: 400 }
      );
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { error: `At most ${MAX_RECIPIENTS} recipients per call` },
        { status: 400 }
      );
    }

    const seen = new Set<string>();
    const unique = recipients.filter((r) => {
      if (seen.has(r.contactId)) return false;
      seen.add(r.contactId);
      return true;
    });

    const [
      { data: property, error: propertyErr },
      { data: contacts, error: contactsErr },
    ] = await Promise.all([
      ctx.supabase
        .from('properties')
        .select('id')
        .eq('id', propertyId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('contacts')
        .select('id')
        .eq('account_id', ctx.accountId)
        .in(
          'id',
          unique.map((r) => r.contactId)
        ),
    ]);
    if (propertyErr) throw propertyErr;
    if (contactsErr) throw contactsErr;
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }
    const owned = new Set((contacts ?? []).map((row) => row.id as string));

    const db = supabaseAdmin();
    let recorded = 0;
    for (const recipient of unique) {
      if (!owned.has(recipient.contactId)) continue;
      await logPropertyShare(
        db,
        ctx.accountId,
        ctx.userId,
        propertyId,
        recipient.contactId,
        recipient.classification,
        { channel, journeyVisible }
      );
      recorded += 1;
    }

    return NextResponse.json({ data: { recorded } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
