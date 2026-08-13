/**
 * Best-effort location derivation from a Google Maps link or a raw
 * coordinate pair, for WhatsApp listing intake when a lister shares a
 * map pin instead of typing an address.
 *
 * Shared pins reach us in every Maps URL shape there is: the opaque
 * `maps.app.goo.gl/...` short link (resolved by following the redirect
 * chain), the canonical `/maps/place/<name>/@lat,lng` form, and the
 * `?api=1&query=lat,lng` search form a WhatsApp location message turns
 * into. All of them are reduced to either a place name or coordinates,
 * and coordinates are reverse-geocoded into locality/city/state parts.
 *
 * Reverse geocoding prefers Google (GOOGLE_MAPS_API_KEY, the same key
 * the property form's autocomplete uses) and falls back to
 * OpenStreetMap's free Nominatim API when no key is configured.
 * Nominatim's usage policy caps that fallback at ~1 request/second and
 * requires a descriptive User-Agent — fine for this app's per-listing
 * lookup volume, but not for bulk/high-volume use.
 */

import { hasGoogleMapsKey, reverseGeocode } from "@/lib/maps/google-places";
import {
  extractCoordinatesFromMapUrl,
  extractPlaceNameFromMapUrl,
  type Coordinates,
} from "@/lib/maps/map-links";

// Re-exported so callers have one maps entry point; the parsing lives
// in map-links.ts because the property form imports it in the browser.
export {
  extractCoordinatesFromMapUrl,
  extractMapLinkFromText,
  extractPlaceNameFromMapUrl,
  googleMapsUrlForCoordinates,
  parseCoordinatePair,
  type Coordinates,
} from "@/lib/maps/map-links";

const FETCH_TIMEOUT_MS = 5000;
const NOMINATIM_USER_AGENT = "ConvoReal/1.0 (WhatsApp property listing intake)";

export interface ResolvedMapLocation {
  /** Human-readable address line for the draft's `location` field. */
  location: string;
  sublocality: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
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

function composeLocation(
  sublocality: string | null,
  city: string | null,
  formattedAddress: string | null
): string | null {
  const compact = [sublocality, city].filter(Boolean).join(", ");
  if (compact) return compact;
  if (formattedAddress) return formattedAddress.replace(/,?\s*India$/i, "").trim() || null;
  return null;
}

async function reverseGeocodeWithNominatim(
  latitude: number,
  longitude: number
): Promise<ResolvedMapLocation | null> {
  const res = await fetchWithTimeout(
    `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=16&lat=${latitude}&lon=${longitude}`,
    { headers: { "User-Agent": NOMINATIM_USER_AGENT } }
  );
  if (!res.ok) return null;

  const geo = (await res.json()) as {
    display_name?: string;
    address?: Record<string, string>;
  };
  const address = geo.address || {};
  const sublocality =
    address.suburb || address.neighbourhood || address.city_district || address.residential || null;
  const city = address.city || address.town || address.village || address.county || null;
  const state = address.state || null;
  const location = composeLocation(sublocality, city, geo.display_name || null);
  if (!location) return null;

  return { location, sublocality, city, state, latitude, longitude };
}

/**
 * Coordinates → a full set of location parts. Never throws; returns
 * null when neither geocoder could name the point.
 */
export async function resolveLocationFromCoordinates(
  latitude: number,
  longitude: number
): Promise<ResolvedMapLocation | null> {
  try {
    if (hasGoogleMapsKey()) {
      const place = await reverseGeocode(latitude, longitude);
      const location = place
        ? composeLocation(place.sublocality, place.city, place.formatted_address)
        : null;
      if (place && location) {
        return {
          location,
          sublocality: place.sublocality,
          city: place.city,
          state: place.state,
          latitude,
          longitude,
        };
      }
    }
    return await reverseGeocodeWithNominatim(latitude, longitude);
  } catch (err) {
    console.error("[maps] resolveLocationFromCoordinates failed:", err);
    return null;
  }
}

/**
 * Coordinates behind a map link, without any geocoding. A pin is an
 * exact point the lister placed, so these beat anything derived from
 * address text — which resolves to the wrong "KHB Colony" or "1st Main"
 * often enough to push a property kilometres off its real location.
 *
 * Short `maps.app.goo.gl` links cost one redirect hop; every other form
 * is parsed straight out of the URL.
 */
export async function resolveCoordinatesFromMapLink(
  url: string
): Promise<Coordinates | null> {
  const inline = extractCoordinatesFromMapUrl(url);
  if (inline) return inline;

  try {
    const res = await fetchWithTimeout(url, { redirect: "follow" });
    return res.url ? extractCoordinatesFromMapUrl(res.url) : null;
  } catch (err) {
    console.error("[maps] resolveCoordinatesFromMapLink failed:", err);
    return null;
  }
}

/**
 * Resolves a Google Maps URL (short or canonical) to the location parts
 * behind it. Returns null on any failure or when nothing usable could be
 * derived — callers should treat this as best-effort, not a guaranteed
 * result.
 */
export async function resolveLocationFromGoogleMapLink(
  url: string
): Promise<ResolvedMapLocation | null> {
  try {
    // Skip the redirect hop when the link already carries what we need.
    let resolvedUrl = url;
    if (!extractCoordinatesFromMapUrl(url) && !extractPlaceNameFromMapUrl(url)) {
      const res = await fetchWithTimeout(url, { redirect: "follow" });
      resolvedUrl = res.url || url;
    }

    const coords = extractCoordinatesFromMapUrl(resolvedUrl);
    // Canonical "place" URLs embed the name directly, e.g.
    // https://www.google.com/maps/place/Jayanagar,+Bengaluru,+Karnataka/@12.925,77.593,15z/...
    // That name is what the lister actually pinned, so it wins over the
    // geocoder's locality — but the geocoder still supplies the parts.
    const placeName = extractPlaceNameFromMapUrl(resolvedUrl);
    const geo = coords
      ? await resolveLocationFromCoordinates(coords.latitude, coords.longitude)
      : null;

    if (geo) {
      const named =
        placeName && geo.city && !placeName.toLowerCase().includes(geo.city.toLowerCase())
          ? `${placeName}, ${geo.city}`
          : placeName;
      return { ...geo, location: named || geo.location };
    }

    if (placeName) {
      return {
        location: placeName,
        sublocality: null,
        city: null,
        state: null,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
      };
    }

    return null;
  } catch (err) {
    console.error("[maps] resolveLocationFromGoogleMapLink failed:", err);
    return null;
  }
}
