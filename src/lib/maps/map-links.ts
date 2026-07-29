/**
 * Pure parsing of Google Maps links and coordinate pairs — no network,
 * no API key, no server-only imports, so the property form can read a
 * pasted pin in the browser exactly the way the intake pipeline reads
 * one on the server (see `resolve-location.ts`, which builds the
 * geocoding on top of these).
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
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
