import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { PORTAL_KEYS, type PortalKey } from '@/lib/portals/post-kit';

// POST /api/contacts/[id]/portal-link   { propertyId }
//
// The agent's one-time assertion: "the Housing ad this lead came in on
// IS this listing." It writes the pair into property_portal_listings,
// which migration 124 keeps one-to-one per portal, and from then on the
// lead webhook resolves every enquiry quoting that ad through it —
// exactly, before any scoring runs.
//
// Asserting it also settles the leads already waiting on that ad: every
// contact in the account carrying the same portal reference is tagged to
// the listing, including the one being reviewed. That is the difference
// between mapping an ad and mapping a lead — the agent does it once and
// the backlog resolves with it.

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId } = await params;
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `contact:portal-link:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));
    const propertyId =
      typeof body?.propertyId === 'string' ? body.propertyId.trim() : '';
    if (!propertyId) {
      return NextResponse.json(
        { error: 'propertyId is required' },
        { status: 400 }
      );
    }

    const { data: contact, error: contactErr } = await ctx.supabase
      .from('contacts')
      .select('id, lead_portal, lead_portal_listing_id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactErr) throw contactErr;
    if (!contact)
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const portal = contact.lead_portal as PortalKey | null;
    const portalListingId = contact.lead_portal_listing_id as string | null;
    if (!portal || !portalListingId || !PORTAL_KEYS.includes(portal)) {
      return NextResponse.json(
        {
          error:
            'This lead did not quote a portal listing id, so there is nothing to map.',
        },
        { status: 400 }
      );
    }

    const { data: property, error: propertyErr } = await ctx.supabase
      .from('properties')
      .select('id, title')
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (propertyErr) throw propertyErr;
    if (!property)
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );

    // One ad, one listing. A second assertion pointing the same ad at a
    // different property is a contradiction, not an update: the agent is
    // told which listing already owns it rather than having the first
    // answer silently replaced.
    //
    // Only a live posting owns an ad, though. A row the agent already
    // marked removed is a posting that is gone from the portal, and it
    // used to keep its id anyway — so the ad could never be re-pointed
    // and the error named a listing that was no longer advertised. The
    // row cannot simply be ignored either: uq_portal_listing_identity
    // (migration 124) is status-agnostic, and the lead webhook resolves
    // the ad with a maybeSingle() that a second holder would break. So
    // the dead row releases the id here, and the assertion proceeds.
    const { data: claimed, error: claimedErr } = await ctx.supabase
      .from('property_portal_listings')
      .select('id, property_id, status, properties(title)')
      .eq('account_id', ctx.accountId)
      .eq('portal', portal)
      .eq('portal_listing_id', portalListingId)
      .maybeSingle();
    if (claimedErr) throw claimedErr;
    if (claimed && claimed.property_id !== propertyId) {
      if (claimed.status === 'active') {
        const claimedTitle =
          (claimed.properties as { title?: string } | null)?.title ??
          'another listing';
        return NextResponse.json(
          {
            error: `${portal} ad ${portalListingId} is already mapped to "${claimedTitle}". Unmap it there first.`,
            code: 'PORTAL_ID_TAKEN',
          },
          { status: 409 }
        );
      }
      const { data: freed, error: releaseErr } = await ctx.supabase
        .from('property_portal_listings')
        .update({ portal_listing_id: null })
        .eq('id', claimed.id)
        .eq('account_id', ctx.accountId)
        .select('id');
      if (releaseErr) {
        return NextResponse.json(
          { error: releaseErr.message },
          { status: 500 }
        );
      }
      if (!freed?.length) {
        return NextResponse.json(
          {
            error: `${portal} ad ${portalListingId} is held by a listing you cannot edit.`,
            code: 'PORTAL_ID_TAKEN',
          },
          { status: 409 }
        );
      }
    }

    const { error: linkErr } = await ctx.supabase
      .from('property_portal_listings')
      .upsert(
        {
          account_id: ctx.accountId,
          property_id: propertyId,
          user_id: ctx.userId,
          portal,
          portal_listing_id: portalListingId,
          status: 'active',
        },
        { onConflict: 'property_id,portal' }
      );
    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 500 });
    }

    // Every lead already waiting on this ad, the one under review
    // included. They enquired about the ad the agent has just identified,
    // so the guesser's answer — or its silence — is superseded.
    const { data: siblings, error: siblingErr } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('lead_portal', portal)
      .eq('lead_portal_listing_id', portalListingId);
    if (siblingErr) throw siblingErr;

    const contactIds = Array.from(
      new Set([contactId, ...(siblings ?? []).map((c) => c.id)])
    );

    const { data: retagged, error: retagErr } = await ctx.supabase
      .from('contacts')
      .update({
        last_inquired_property_id: propertyId,
        updated_at: new Date().toISOString(),
      })
      .in('id', contactIds)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (retagErr) {
      return NextResponse.json({ error: retagErr.message }, { status: 500 });
    }

    const { error: inquiryErr } = await ctx.supabase
      .from('contact_property_inquiries')
      .upsert(
        (retagged ?? []).map((c) => ({
          account_id: ctx.accountId,
          contact_id: c.id,
          property_id: propertyId,
          inquiry_source: portal,
        })),
        { onConflict: 'contact_id,property_id' }
      );
    if (inquiryErr) {
      return NextResponse.json({ error: inquiryErr.message }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        portal,
        portalListingId,
        propertyId,
        propertyTitle: property.title as string,
        taggedContacts: retagged?.length ?? 0,
      },
    });
  } catch (err) {
    console.error(
      '[POST /api/contacts/[id]/portal-link] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}

// DELETE /api/contacts/[id]/portal-link
//
// The inverse of the assertion above: the agent mapped the ad to the
// wrong listing and needs it back. Releasing the id from whichever
// listing holds it is only half of that — the mapping also re-pointed
// every lead waiting on the ad, so leaving those tags behind would
// answer the correction with the wrong listing still on the contact.
// Both halves undo together, exactly as they were applied.
//
// Only leads still pointing at the mapped listing are untagged. One an
// agent has since filed somewhere else by hand is their answer, not the
// mapping's, and is left alone.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId } = await params;
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `contact:portal-link:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: contact, error: contactErr } = await ctx.supabase
      .from('contacts')
      .select('id, lead_portal, lead_portal_listing_id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactErr) throw contactErr;
    if (!contact)
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const portal = contact.lead_portal as PortalKey | null;
    const portalListingId = contact.lead_portal_listing_id as string | null;
    if (!portal || !portalListingId || !PORTAL_KEYS.includes(portal)) {
      return NextResponse.json(
        {
          error:
            'This lead did not quote a portal listing id, so there is nothing to unmap.',
        },
        { status: 400 }
      );
    }

    const { data: link, error: linkReadErr } = await ctx.supabase
      .from('property_portal_listings')
      .select('id, property_id')
      .eq('account_id', ctx.accountId)
      .eq('portal', portal)
      .eq('portal_listing_id', portalListingId)
      .maybeSingle();
    if (linkReadErr) throw linkReadErr;
    if (!link) {
      return NextResponse.json(
        {
          error: `${portal} ad ${portalListingId} is not mapped to a listing.`,
        },
        { status: 404 }
      );
    }

    // The posting itself is untouched: the row keeps its URL, expiry and
    // status so the portal badges and the expiry reminder still know the
    // listing is live. Only the identity claim is dropped.
    const { data: released, error: releaseErr } = await ctx.supabase
      .from('property_portal_listings')
      .update({ portal_listing_id: null })
      .eq('id', link.id)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (releaseErr) {
      return NextResponse.json({ error: releaseErr.message }, { status: 500 });
    }
    if (!released?.length) {
      return NextResponse.json(
        { error: 'You do not have permission to edit this listing.' },
        { status: 403 }
      );
    }

    const { data: untagged, error: untagErr } = await ctx.supabase
      .from('contacts')
      .update({
        last_inquired_property_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId)
      .eq('lead_portal', portal)
      .eq('lead_portal_listing_id', portalListingId)
      .eq('last_inquired_property_id', link.property_id)
      .select('id');
    if (untagErr) {
      return NextResponse.json({ error: untagErr.message }, { status: 500 });
    }

    const untaggedIds = (untagged ?? []).map((c) => c.id);
    if (untaggedIds.length) {
      const { error: inquiryErr } = await ctx.supabase
        .from('contact_property_inquiries')
        .delete()
        .eq('property_id', link.property_id)
        .in('contact_id', untaggedIds)
        .select('contact_id');
      if (inquiryErr) {
        return NextResponse.json(
          { error: inquiryErr.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      data: {
        portal,
        portalListingId,
        propertyId: link.property_id as string,
        untaggedContacts: untaggedIds.length,
      },
    });
  } catch (err) {
    console.error(
      '[DELETE /api/contacts/[id]/portal-link] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}
