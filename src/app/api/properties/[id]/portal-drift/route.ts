import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { findPortalDiscrepancies } from '@/lib/portals/listing-reconcile';
import type { PortalListingFigures } from '@/lib/portals/listing-reconcile';

// GET /api/properties/[id]/portal-drift
//
// Where this listing and its portal copies disagree. Read-only and
// opinion-free: it names the gap, it does not decide which figure is
// right — that is a question about the property, and only the agent
// can answer it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id } = await params;

    const [{ data: property }, { data: items }] = await Promise.all([
      ctx.supabase
        .from('properties')
        .select('price, area_sqft, land_area, land_area_unit, bedrooms')
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('portal_import_items')
        .select('portal, listing_url, price, area_sqft, bedrooms')
        .eq('account_id', ctx.accountId)
        .eq('matched_property_id', id)
        .in('match_status', ['linked', 'auto_matched', 'imported']),
    ]);

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const listings: PortalListingFigures[] = (items ?? []).map((row) => ({
      portal: row.portal as PortalListingFigures['portal'],
      listingUrl: row.listing_url,
      price: row.price,
      areaSqft: row.area_sqft,
      bedrooms: row.bedrooms,
    }));

    return NextResponse.json({
      data: findPortalDiscrepancies(property, listings),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
