import { NextResponse } from 'next/server';
import {
  requireRole,
  toErrorResponse,
  ForbiddenError,
} from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  canViewExactLocation,
  maskName,
  maskPhone,
} from '@/lib/inventory/location-guard';
import {
  approveRequestAndSendReveal,
  closeRequestWithRedirect,
  type LocationRequestRow,
} from '@/lib/inventory/location-requests';

// Co-broker-attributed requests keep the seeker's identity masked from
// the listing side EVERYWHERE — that client belongs to the co-broker.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function maskAttributed(row: any) {
  if (!row.via_contact_id && !row.via_share_id) return row;
  return {
    ...row,
    requester_name: maskName(row.requester_name || ''),
    requester_phone: maskPhone(row.requester_phone || ''),
    identity_protected: true,
  };
}

// GET /api/properties/[id]/location-requests
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: propertyId } = await params;

    const { data: property } = await ctx.supabase
      .from('properties')
      .select('id')
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('property_location_requests')
      .select('*')
      .eq('property_id', propertyId)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET location-requests]', error);
      return NextResponse.json(
        { error: 'Failed to fetch requests' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: (data ?? []).map(maskAttributed) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/properties/[id]/location-requests
// The listing side's final decision. Only an admin or the property's
// listing agent may decide; a request still awaiting co-broker consent
// can be rejected but not approved.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: propertyId } = await params;

    const body = await request.json().catch(() => null);
    const { request_id, action } = body || {};
    if (!request_id || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: "request_id and action ('approve'|'reject') are required" },
        { status: 400 }
      );
    }

    const { data: property } = await ctx.supabase
      .from('properties')
      .select('id, type, user_id, location_privacy')
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }
    if (
      !canViewExactLocation(
        { role: ctx.role, userId: ctx.userId },
        property as {
          type: string;
          user_id: string | null;
          location_privacy?: string | null;
        }
      )
    ) {
      throw new ForbiddenError(
        'Only admins or the listing agent can decide location requests'
      );
    }

    const { data, error: fetchErr } = await ctx.supabase
      .from('property_location_requests')
      .select('*')
      .eq('id', request_id)
      .eq('property_id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const locRequest = data as LocationRequestRow | null;

    if (fetchErr || !locRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (locRequest.status !== 'pending') {
      return NextResponse.json(
        { error: 'This request has already been processed' },
        { status: 409 }
      );
    }

    const admin = supabaseAdmin();

    if (action === 'reject') {
      await closeRequestWithRedirect(admin, locRequest, 'rejected');
      const { data: updated } = await ctx.supabase
        .from('property_location_requests')
        .select('*')
        .eq('id', request_id)
        .maybeSingle();
      return NextResponse.json({ data: maskAttributed(updated) });
    }

    if (locRequest.pending_consent_contact_id) {
      return NextResponse.json(
        { error: "This request is still awaiting the co-broker's consent" },
        { status: 409 }
      );
    }

    const { shareLink, revealDelivered } = await approveRequestAndSendReveal(
      admin,
      locRequest,
      ctx.userId
    );
    const { data: updated } = await ctx.supabase
      .from('property_location_requests')
      .select('*')
      .eq('id', request_id)
      .maybeSingle();

    return NextResponse.json({
      data: maskAttributed(updated),
      share_link: shareLink,
      reveal_sent: revealDelivered,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
