// ============================================================
// /api/buyer/shortlist — the buyer's saved properties.
//
// GET returns shortlist rows joined with public-safe property fields
// (the same column discipline as /api/public/properties — never
// documents or owner data) plus a showcase deep link per row.
// POST saves a published property; the account scope is derived from
// the property row itself, never from the client.
// ============================================================

import { NextResponse } from 'next/server';

import { UserFacingError } from '@/lib/auth/account';
import { withBuyerAuth, buyerAdmin } from '@/lib/buyer/auth';
import { storagePublicUrl } from '@/lib/storage/url';

const PROPERTY_CARD_COLUMNS =
  'id, account_id, title, price, location, sublocality, city, type, status, listing_type, rent_per_month, bedrooms, bathrooms, area_sqft, area_unit, images, property_code, is_published';

interface ShortlistPropertyRow {
  id: string;
  account_id: string;
  title: string;
  price: number | null;
  location: string | null;
  sublocality: string | null;
  city: string | null;
  type: string | null;
  status: string | null;
  listing_type: string | null;
  rent_per_month: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  area_unit: string | null;
  images: string[] | null;
  property_code: string | null;
  is_published: boolean | null;
}

export const GET = withBuyerAuth(async (ctx) => {
  const db = buyerAdmin();
  const { data: items, error } = await db
    .from('buyer_shortlist_items')
    .select(
      `id, account_id, contact_id, source, created_at, property:properties(${PROPERTY_CARD_COLUMNS})`
    )
    .eq('buyer_user_id', ctx.buyerUserId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[buyer/shortlist GET] fetch failed:', error);
    return NextResponse.json(
      { error: 'Could not load shortlist' },
      { status: 500 }
    );
  }

  const agencyByAccount = new Map(
    ctx.links.map((l) => [l.accountId, l.agencyName])
  );
  const rows = (items || []).flatMap((item) => {
    const property = (
      Array.isArray(item.property) ? item.property[0] : item.property
    ) as ShortlistPropertyRow | null;
    if (!property) return [];
    const params = new URLSearchParams({
      property_id: property.property_code || property.id,
      ref: item.account_id as string,
    });
    if (item.contact_id) params.set('v', item.contact_id as string);
    return [
      {
        id: item.id,
        source: item.source,
        created_at: item.created_at,
        agency_name: agencyByAccount.get(item.account_id as string) ?? null,
        showcase_path: `/?${params.toString()}`,
        property: {
          ...property,
          images: Array.isArray(property.images)
            ? property.images.map(storagePublicUrl)
            : property.images,
          available:
            property.is_published === true && property.status === 'Available',
        },
      },
    ];
  });

  return NextResponse.json({ items: rows });
});

export const POST = withBuyerAuth(async (ctx, req) => {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const propertyId =
    typeof body?.property_id === 'string' ? body.property_id : null;
  if (!propertyId) throw new UserFacingError('property_id is required');

  const db = buyerAdmin();
  const { data: property } = await db
    .from('properties')
    .select('id, account_id, is_published')
    .eq('id', propertyId)
    .maybeSingle();

  if (!property || !property.is_published) {
    throw new UserFacingError('Property not found');
  }

  const contactId =
    ctx.links.find((l) => l.accountId === property.account_id)?.contactId ??
    null;

  const { error } = await db.from('buyer_shortlist_items').upsert(
    {
      buyer_user_id: ctx.buyerUserId,
      account_id: property.account_id,
      property_id: property.id,
      contact_id: contactId,
      source: 'manual',
    },
    { onConflict: 'buyer_user_id,property_id', ignoreDuplicates: true }
  );

  if (error) {
    console.error('[buyer/shortlist POST] upsert failed:', error);
    return NextResponse.json(
      { error: 'Could not save property' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
});
