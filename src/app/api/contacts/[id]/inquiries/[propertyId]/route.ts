import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  buildPropertyInterestFollowUpMessage,
  sendPropertyInterestFollowUp,
  type PropertyInterestFollowUpTarget,
} from '@/lib/whatsapp/property-interest-followup';
import type { Contact, Property } from '@/types';

// DELETE /api/contacts/[id]/inquiries/[propertyId]
//
// Detach a listing from a contact: drop the junction row and, when the
// contact's headline pointer names the same listing, clear that too.
// Both surfaces used to do this as two client writes each, which meant
// the pointer could survive the row it was supposed to follow — and it
// left web and mobile free to disagree about a rule neither of them
// owns. The pair belongs together, on the server.
//
// This is the correction an agent reaches for when a portal lead was
// filed against the wrong listing.

type RouteParams = { params: Promise<{ id: string; propertyId: string }> };

async function loadInterestTarget(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  contactId: string,
  propertyId: string
): Promise<PropertyInterestFollowUpTarget | null> {
  const [contactResult, propertyResult, inquiryResult] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, phone, last_inquired_property_id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle(),
    supabase
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .maybeSingle(),
    supabase
      .from('contact_property_inquiries')
      .select('property_id')
      .eq('contact_id', contactId)
      .eq('property_id', propertyId)
      .maybeSingle(),
  ]);
  if (contactResult.error) throw contactResult.error;
  if (propertyResult.error) throw propertyResult.error;
  if (inquiryResult.error) throw inquiryResult.error;
  if (!contactResult.data || !propertyResult.data) return null;
  if (
    !inquiryResult.data &&
    contactResult.data.last_inquired_property_id !== propertyId
  ) {
    return null;
  }
  return {
    contact: contactResult.data as Pick<Contact, 'id' | 'name' | 'phone'>,
    property: propertyResult.data as Property,
  };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId, propertyId } = await params;
    const ctx = await requireRole('agent');
    const target = await loadInterestTarget(
      ctx.supabase,
      ctx.accountId,
      contactId,
      propertyId
    );
    if (!target) {
      return NextResponse.json(
        { error: 'Interested property not found' },
        { status: 404 }
      );
    }
    const message = await buildPropertyInterestFollowUpMessage({
      db: ctx.supabase,
      accountId: ctx.accountId,
      target,
    });
    return NextResponse.json({
      data: { message, phone: target.contact.phone },
    });
  } catch (err) {
    console.error(
      '[GET /api/contacts/[id]/inquiries/[propertyId]] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId, propertyId } = await params;
    const ctx = await requireRole('agent');
    const limit = await checkRateLimit(
      `contact:inquiry-followup:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const target = await loadInterestTarget(
      ctx.supabase,
      ctx.accountId,
      contactId,
      propertyId
    );
    if (!target) {
      return NextResponse.json(
        { error: 'Interested property not found' },
        { status: 404 }
      );
    }
    const result = await sendPropertyInterestFollowUp({
      db: ctx.supabase,
      accountId: ctx.accountId,
      userId: ctx.userId,
      target,
    });
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Could not send the check-in' },
        { status: 409 }
      );
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error(
      '[POST /api/contacts/[id]/inquiries/[propertyId]] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId, propertyId } = await params;
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `contact:inquiry:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: contact, error: contactErr } = await ctx.supabase
      .from('contacts')
      .select('id, last_inquired_property_id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactErr) throw contactErr;
    if (!contact)
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    // Scoped by the contact, which the read above already proved belongs
    // to this account. Filtering on the junction's own account_id would
    // be stricter but wrong: migration 259 added that column nullable,
    // so a row written before it — or by a writer that missed it — would
    // survive the correction it is the subject of.
    const { data: removed, error: deleteErr } = await ctx.supabase
      .from('contact_property_inquiries')
      .delete()
      .eq('contact_id', contactId)
      .eq('property_id', propertyId)
      .select('contact_id');
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    // A missing junction row is not a failure on its own — the tag an
    // agent is correcting is often only the pointer, which the lead
    // webhook and the older import paths both set without a row. Neither
    // one present is: nothing was tagged, so nothing was corrected.
    const pointerNamed = contact.last_inquired_property_id === propertyId;
    if (!removed?.length && !pointerNamed) {
      return NextResponse.json(
        { error: 'That interest is no longer there.' },
        { status: 404 }
      );
    }

    let pointerCleared = false;
    if (pointerNamed) {
      const { data: cleared, error: clearErr } = await ctx.supabase
        .from('contacts')
        .update({
          last_inquired_property_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .select('id');
      if (clearErr) {
        return NextResponse.json({ error: clearErr.message }, { status: 500 });
      }
      if (!cleared?.length) {
        return NextResponse.json(
          { error: 'You do not have permission to edit this contact.' },
          { status: 403 }
        );
      }
      pointerCleared = true;
    }

    return NextResponse.json({ data: { removed: true, pointerCleared } });
  } catch (err) {
    console.error(
      '[DELETE /api/contacts/[id]/inquiries/[propertyId]] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}
