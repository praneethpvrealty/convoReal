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
    const { data: claimed, error: claimedErr } = await ctx.supabase
      .from('property_portal_listings')
      .select('property_id, properties(title)')
      .eq('account_id', ctx.accountId)
      .eq('portal', portal)
      .eq('portal_listing_id', portalListingId)
      .maybeSingle();
    if (claimedErr) throw claimedErr;
    if (claimed && claimed.property_id !== propertyId) {
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
