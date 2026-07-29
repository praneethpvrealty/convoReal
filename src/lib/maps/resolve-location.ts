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

const FETCH_TIMEOUT_MS = 5000;
const NOMINATIM_USER_AGENT = "ConvoRealCRM/1.0 (WhatsApp property listing intake)";

export interface ResolvedMapLocation {
  /** Human-readable address line for the draft's `location` field. */
  location: string;
  sublocality: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
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

function toCoordinates(lat: string | number, lng: string | number): Coordinates | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

/**
 * Reads a bare "12.8669,77.5565" pair out of free text — a WhatsApp
 * pin whose name/address the sender's app omitted arrives exactly like
 * this, with no link to go on.
 */
export function parseCoordinatePair(text: string | null | undefined): Coordinates | null {
  if (!text) return null;
  const match = text
    .trim()
    .match(/^\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?$/);
  if (!match) return null;
  // Require a decimal part on at least one side so "30, 77" (a plot
  // dimension, a floor count) isn't mistaken for a pin.
  if (!match[1].includes(".") && !match[2].includes(".")) return null;
  return toCoordinates(match[1], match[2]);
}

/** Builds the canonical Maps URL for a pin, matching the form the
 *  appointment reminders already send. */
export function googleMapsUrlForCoordinates(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

const COORD_QUERY_PARAMS = ["query", "q", "ll", "center", "daddr", "destination", "sll", "mlat"];

/**
 * Pulls coordinates out of a canonical Maps URL. Handles the pin-share
 * query forms (`?api=1&query=lat,lng`, `?q=`, `?ll=`), the place-detail
 * form (`!3dlat!4dlng`), the viewport form (`@lat,lng,17z`), and a bare
 * `/maps/search/lat,+lng` path segment.
 */
export function extractCoordinatesFromMapUrl(url: string): Coordinates | null {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }

  if (parsed) {
    if (parsed.searchParams.has("mlat") && parsed.searchParams.has("mlon")) {
      const coords = toCoordinates(
        parsed.searchParams.get("mlat")!,
        parsed.searchParams.get("mlon")!
      );
      if (coords) return coords;
    }
    for (const param of COORD_QUERY_PARAMS) {
      const value = parsed.searchParams.get(param);
      const coords = parseCoordinatePair(value?.replace(/\+/g, " "));
      if (coords) return coords;
    }
  }

  const placeCoords = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (placeCoords) {
    const coords = toCoordinates(placeCoords[1], placeCoords[2]);
    if (coords) return coords;
  }

  const viewport = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (viewport) {
    const coords = toCoordinates(viewport[1], viewport[2]);
    if (coords) return coords;
  }

  const pathPair = decodeURIComponent(parsed?.pathname || url)
    .replace(/\+/g, " ")
    .match(/\/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)(?:\/|$)/);
  if (pathPair) {
    const coords = toCoordinates(pathPair[1], pathPair[2]);
    if (coords) return coords;
  }

  return null;
}

/** Reads the place name embedded in a canonical `/maps/place/<name>` URL. */
export function extractPlaceNameFromMapUrl(url: string): string | null {
  const placeMatch = url.match(/\/maps\/place\/([^/@?]+)/);
  if (!placeMatch) return null;
  const placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, " ")).trim();
  // Guard against a bare coordinate pair, a plus code, or an empty
  // segment slipping through as a "place name".
  if (!placeName || parseCoordinatePair(placeName)) return null;
  if (/^[23456789CFGHJMPQRVWX]{4,}\+[23456789CFGHJMPQRVWX]{2,}/.test(placeName)) return null;
  return placeName;
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
