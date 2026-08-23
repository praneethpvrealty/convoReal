import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchAudienceListings } from '@/lib/inventory/listing-audience';

// GET /api/properties/audiences?limit=25
// Listings that have an engaged audience, with per-listing contact
// counts — the picker behind "share this with a listing's audience".
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const limitParam = new URL(request.url).searchParams.get('limit');
    const parsed = Number(limitParam);
    const limit =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : 25;

    const listings = await fetchAudienceListings(
      ctx.supabase,
      ctx.accountId,
      limit
    );
    return NextResponse.json({ data: listings });
  } catch (err) {
    return toErrorResponse(err);
  }
}
