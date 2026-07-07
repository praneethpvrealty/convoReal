import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { hasGoogleMapsKey, placeDetails } from '@/lib/maps/google-places';

// GET /api/maps/place-details?place_id=...&session=<uuid>
//
// Resolves a picked autocomplete suggestion to coordinates + address
// parts. Passing the same session token as the autocomplete calls
// closes the billing session.

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('viewer');

    const limit = checkRateLimit(`maps:place-details:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    if (!hasGoogleMapsKey()) {
      return NextResponse.json({ error: 'Maps API not configured' }, { status: 501 });
    }

    const placeId = request.nextUrl.searchParams.get('place_id')?.trim() || '';
    const session = request.nextUrl.searchParams.get('session')?.trim() || undefined;
    if (!placeId) {
      return NextResponse.json({ error: 'place_id is required' }, { status: 400 });
    }

    const place = await placeDetails(placeId, session);
    return NextResponse.json({ place });
  } catch (err) {
    console.error('[GET /api/maps/place-details] Error:', err);
    return toErrorResponse(err);
  }
}
