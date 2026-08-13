import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

// GET /api/portals/drift
//
// Mapped portal ads whose recorded state has diverged from reality —
// computed by portal_listing_drift (migration 267) from data already in
// the database, so it needs nothing from the portals themselves.
//
// Stateless: a finding disappears when the condition is fixed (listing
// relisted, expiry updated, ad marked removed), so there is nothing to
// dismiss and nothing to go stale.

export type PortalDriftKind =
  | 'withdrawn_stock'
  | 'stale_expiry'
  | 'likely_lapsed'
  | 'details_drift';

export interface PortalDriftFinding {
  portal: string;
  portalListingId: string;
  listingUrl: string | null;
  expiresOn: string | null;
  propertyId: string;
  propertyTitle: string | null;
  propertyCode: string | null;
  propertyStatus: string | null;
  driftKind: PortalDriftKind;
  leadCount: number;
  lastLeadAt: string | null;
  parsedPropertyType: string | null;
  parsedPrice: number | null;
  parsedAreaSqft: number | null;
  listingType: string | null;
  listingPrice: number | null;
  listingAreaSqft: number | null;
}

interface DriftRow {
  portal: string;
  portal_listing_id: string;
  listing_url: string | null;
  expires_on: string | null;
  property_id: string;
  property_title: string | null;
  property_code: string | null;
  property_status: string | null;
  drift_kind: PortalDriftKind;
  lead_count: number | string;
  last_lead_at: string | null;
  parsed_property_type: string | null;
  parsed_price: number | string | null;
  parsed_area_sqft: number | string | null;
  listing_type: string | null;
  listing_price: number | string | null;
  listing_area_sqft: number | string | null;
}

const toNumber = (value: number | string | null): number | null =>
  value === null || value === undefined ? null : Number(value);

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase.rpc('portal_listing_drift', {
      target_account_id: ctx.accountId,
    });
    if (error) throw error;

    const findings: PortalDriftFinding[] = ((data ?? []) as DriftRow[]).map(
      (row) => ({
        portal: row.portal,
        portalListingId: row.portal_listing_id,
        listingUrl: row.listing_url,
        expiresOn: row.expires_on,
        propertyId: row.property_id,
        propertyTitle: row.property_title,
        propertyCode: row.property_code,
        propertyStatus: row.property_status,
        driftKind: row.drift_kind,
        leadCount: Number(row.lead_count),
        lastLeadAt: row.last_lead_at,
        parsedPropertyType: row.parsed_property_type,
        parsedPrice: toNumber(row.parsed_price),
        parsedAreaSqft: toNumber(row.parsed_area_sqft),
        listingType: row.listing_type,
        listingPrice: toNumber(row.listing_price),
        listingAreaSqft: toNumber(row.listing_area_sqft),
      })
    );

    return NextResponse.json({ data: findings });
  } catch (err) {
    console.error('[GET /api/portals/drift] Unexpected error:', err);
    return toErrorResponse(err);
  }
}
