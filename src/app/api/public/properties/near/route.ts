import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  geocodeAddress,
  hasGoogleMapsKey,
  type GeocodedLocation,
} from '@/lib/maps/google-places';
import {
  dominantCity,
  geocodeQuery,
  placeLabel,
  rankNearbyListings,
  type NearbyCandidate,
} from '@/lib/showcase/nearby-search';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GEOCODE_CACHE_CAP = 500;
const geocodeCache = new Map<string, GeocodedLocation | null>();

function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

async function cachedGeocode(
  address: string
): Promise<GeocodedLocation | null> {
  const key = address.toLocaleLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;
  const result = await geocodeAddress(address).catch(() => null);
  if (geocodeCache.size >= GEOCODE_CACHE_CAP) {
    const oldest = geocodeCache.keys().next().value;
    if (oldest !== undefined) geocodeCache.delete(oldest);
  }
  geocodeCache.set(key, result);
  return result;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('account_id')?.trim() || '';
  const query = searchParams.get('q')?.trim().replace(/\s+/g, ' ') || '';

  if (!UUID.test(accountId)) {
    return NextResponse.json(
      { error: 'A valid account_id is required' },
      { status: 400 }
    );
  }
  if (query.length < 3 || query.length > 80) {
    return NextResponse.json(
      { error: 'Search for a place between 3 and 80 characters' },
      { status: 400 }
    );
  }

  const ipLimit = await checkRateLimit(
    `public-near:ip:${clientIp(request)}`,
    RATE_LIMITS.publicNearSearch
  );
  if (!ipLimit.success) return rateLimitResponse(ipLimit);

  const accountLimit = await checkRateLimit(
    `public-near:account:${accountId}`,
    RATE_LIMITS.publicNearSearchAccountDaily
  );
  if (!accountLimit.success) return rateLimitResponse(accountLimit);

  const { data, error } = await supabaseAdmin()
    .from('properties')
    .select(
      'id, latitude, longitude, city, locality_canonical, sublocality, location, project, title'
    )
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available');

  if (error) {
    console.error('[GET /api/public/properties/near] select error:', error);
    return NextResponse.json(
      { error: 'Failed to search nearby listings' },
      { status: 500 }
    );
  }

  const rows = (data || []) as NearbyCandidate[];
  const place =
    rows.length > 0 && hasGoogleMapsKey()
      ? await cachedGeocode(geocodeQuery(query, dominantCity(rows)))
      : null;
  const label = placeLabel(place?.formatted_address ?? null, query);

  return NextResponse.json({
    data: {
      label,
      results: rankNearbyListings(rows, place, [...new Set([label, query])]),
    },
  });
}
