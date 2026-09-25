import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { randomUUID } from 'node:crypto';
import {
  hasGoogleMapsKey,
  placeDetails,
  placesAutocomplete,
} from '@/lib/maps/google-places';
import {
  dominantCity,
  geocodeQuery,
  inventoryCentre,
  rankNearbyListings,
  type NearbyCandidate,
  type NearbyCentre,
} from '@/lib/showcase/nearby-search';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACE_CACHE_CAP = 500;
const PLACE_BIAS_RADIUS_KM = 30;
type ResolvedCentre = NearbyCentre & { label: string };

const placeCache = new Map<string, ResolvedCentre | null>();

function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

async function resolvePlace(
  text: string,
  bias: NearbyCentre | null
): Promise<ResolvedCentre | null> {
  const session = randomUUID();
  const [first] = await placesAutocomplete(text, session, {
    regionsOnly: true,
    bias: bias ? { ...bias, radiusKm: PLACE_BIAS_RADIUS_KM } : undefined,
  });
  if (!first) return null;
  const place = await placeDetails(first.place_id, session);
  return {
    latitude: place.latitude,
    longitude: place.longitude,
    label: place.name || first.main_text,
  };
}

async function cachedPlace(
  text: string,
  bias: NearbyCentre | null
): Promise<ResolvedCentre | null> {
  const key = text.toLocaleLowerCase();
  if (placeCache.has(key)) return placeCache.get(key) ?? null;
  const result = await resolvePlace(text, bias).catch(() => null);
  if (placeCache.size >= PLACE_CACHE_CAP) {
    const oldest = placeCache.keys().next().value;
    if (oldest !== undefined) placeCache.delete(oldest);
  }
  placeCache.set(key, result);
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
      ? await cachedPlace(
          geocodeQuery(query, dominantCity(rows)),
          inventoryCentre(rows)
        )
      : null;
  const label = place?.label || query;

  return NextResponse.json({
    data: {
      label,
      results: rankNearbyListings(rows, place, [...new Set([label, query])]),
    },
  });
}
