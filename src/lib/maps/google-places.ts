/**
 * Server-side Google Places / Geocoding client.
 *
 * The API key (GOOGLE_MAPS_API_KEY) lives only on the server — the
 * browser talks to our /api/maps/* proxy routes, never to Google
 * directly. All lookups are region-biased to India.
 *
 * Uses the new Places API (places.googleapis.com/v1). Autocomplete
 * calls carry a session token so Google bills a typing session +
 * details pick as one session instead of per keystroke.
 */

const FETCH_TIMEOUT_MS = 6000;

export function hasGoogleMapsKey(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error('GOOGLE_MAPS_API_KEY is not configured. Add it to .env.local.');
  }
  return key;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export interface PlaceSuggestion {
  place_id: string;
  /** Primary line, e.g. "HSR Layout". */
  main_text: string;
  /** Secondary line, e.g. "Bengaluru, Karnataka, India". */
  secondary_text: string;
}

export async function placesAutocomplete(
  input: string,
  sessionToken: string
): Promise<PlaceSuggestion[]> {
  const res = await fetchWithTimeout('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
    },
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ['in'],
      languageCode: 'en',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Places autocomplete failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
        text?: { text?: string };
      };
    }>;
  };

  return (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .map((p) => ({
      place_id: p.placeId!,
      main_text: p.structuredFormat?.mainText?.text || p.text?.text || '',
      secondary_text: p.structuredFormat?.secondaryText?.text || '',
    }))
    .filter((p) => p.main_text);
}

export interface ResolvedPlace {
  place_id: string;
  name: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  /** Best-effort address parts for pre-filling form fields. */
  sublocality: string | null;
  city: string | null;
  state: string | null;
}

export async function placeDetails(placeId: string, sessionToken?: string): Promise<ResolvedPlace> {
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set('languageCode', 'en');
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

  const res = await fetchWithTimeout(url.toString(), {
    headers: {
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,addressComponents',
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Place details failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    addressComponents?: Array<{ longText?: string; types?: string[] }>;
  };

  if (data.location?.latitude === undefined || data.location?.longitude === undefined) {
    throw new Error('Place details response missing coordinates');
  }

  const component = (type: string) =>
    data.addressComponents?.find((c) => c.types?.includes(type))?.longText || null;

  return {
    place_id: data.id,
    name: data.displayName?.text || '',
    formatted_address: data.formattedAddress || '',
    latitude: data.location.latitude,
    longitude: data.location.longitude,
    sublocality:
      component('sublocality_level_1') || component('sublocality') || component('neighborhood'),
    city: component('locality'),
    state: component('administrative_area_level_1'),
  };
}

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  place_id: string | null;
  formatted_address: string | null;
}

/**
 * Free-text address → coordinates via the Geocoding API. Used by the
 * server-side save fallback and the backfill script for properties
 * whose location was typed rather than picked from autocomplete.
 */
export async function geocodeAddress(address: string): Promise<GeocodedLocation | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('region', 'in');
  url.searchParams.set('key', apiKey());

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) return null;

  const data = (await res.json()) as {
    status?: string;
    results?: Array<{
      place_id?: string;
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };

  const first = data.results?.[0];
  const loc = first?.geometry?.location;
  if (data.status !== 'OK' || !first || loc?.lat === undefined || loc?.lng === undefined) {
    return null;
  }

  return {
    latitude: loc.lat,
    longitude: loc.lng,
    place_id: first.place_id || null,
    formatted_address: first.formatted_address || null,
  };
}
