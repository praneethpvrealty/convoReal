import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { maskName, maskPhone } from '@/lib/inventory/location-guard';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// GET /api/location-requests
// Account-wide view of location reveal requests for the approval-flow
// dashboard: every request with its property, current state and the
// consent journey (each intermediary hop, named, with decision and
// timestamp). Requests that arrived through a co-broker share keep the
// seeker's identity masked — that client belongs to the co-broker.
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(
        1,
        parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10)
      )
    );

    const { data, error } = await ctx.supabase
      .from('property_location_requests')
      .select(
        'id, property_id, requester_name, requester_phone, status, via_contact_id, via_share_id, consent_chain, pending_consent_contact_id, consent_requested_at, approved_at, share_sent_at, view_count, last_viewed_at, created_at, property:properties(id, title, property_code)'
      )
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[GET /api/location-requests]', error);
      return NextResponse.json(
        { error: 'Failed to fetch requests' },
        { status: 500 }
      );
    }

    const rows = data ?? [];

    // Resolve every chain participant's name in one query.
    const contactIds = new Set<string>();
    for (const row of rows) {
      const chain = Array.isArray(row.consent_chain) ? row.consent_chain : [];
      for (const hop of chain) {
        if (hop?.contact_id) contactIds.add(hop.contact_id);
      }
      if (row.pending_consent_contact_id) {
        contactIds.add(row.pending_consent_contact_id);
      }
      if (row.via_contact_id) contactIds.add(row.via_contact_id);
    }

    const nameById = new Map<string, string>();
    if (contactIds.size > 0) {
      const { data: contacts } = await ctx.supabase
        .from('contacts')
        .select('id, name')
        .eq('account_id', ctx.accountId)
        .in('id', [...contactIds]);
      for (const c of contacts ?? []) {
        nameById.set(c.id, c.name || 'Unknown contact');
      }
    }

    const enriched = rows.map((row) => {
      const attributed = Boolean(row.via_contact_id || row.via_share_id);
      const chain = (
        Array.isArray(row.consent_chain) ? row.consent_chain : []
      ).map((hop: { contact_id: string; decision: string; at: string }) => ({
        ...hop,
        contact_name: nameById.get(hop.contact_id) || 'Unknown contact',
      }));
      const property = Array.isArray(row.property)
        ? row.property[0]
        : row.property;
      return {
        id: row.id,
        property_id: row.property_id,
        property_title: property?.title || 'Property',
        property_code: property?.property_code || null,
        requester_name: attributed
          ? maskName(row.requester_name || '')
          : row.requester_name,
        requester_phone: attributed
          ? maskPhone(row.requester_phone || '')
          : row.requester_phone,
        identity_protected: attributed,
        via_contact_name: row.via_contact_id
          ? nameById.get(row.via_contact_id) || 'Unknown contact'
          : null,
        status: row.status,
        consent_chain: chain,
        pending_consent_contact_name: row.pending_consent_contact_id
          ? nameById.get(row.pending_consent_contact_id) || 'Unknown contact'
          : null,
        consent_requested_at: row.consent_requested_at,
        approved_at: row.approved_at,
        share_sent_at: row.share_sent_at,
        view_count: row.view_count ?? 0,
        last_viewed_at: row.last_viewed_at,
        created_at: row.created_at,
      };
    });

    return NextResponse.json({ data: enriched });
  } catch (err) {
    return toErrorResponse(err);
  }
}
