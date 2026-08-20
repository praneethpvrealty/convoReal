/**
 * Mirror of the pin half of `src/lib/maps/map-links.ts` — the same
 * pure resolution, so a property's map pin is the same place on the
 * app, on the showcase, and in the WhatsApp message the Engine sends.
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

export interface PropertyMapPinSource {
  google_map_link?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  location?: string | null;
  sublocality?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface PropertyMapPin {
  /** Where "Open in Google Maps" goes. */
  mapUrl: string;
  /** `output=embed` source for the same place, or null when the place
   *  cannot be embedded (a short link with no address to fall back on). */
  embedUrl: string | null;
  coordinates: Coordinates | null;
}

function addressQuery(source: PropertyMapPinSource): string {
  return [source.location, source.sublocality, source.city, source.state]
    .map((v) => (v || "").trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(", ");
}

/**
 * The one place a property's map pin is resolved, so every surface —
 * the showcase card, the reveal page, the WhatsApp reveal message —
 * points at the SAME place. The embed used to be built from a text
 * search over the locality whenever the stored link was not of the
 * `?q=` shape, which put the iframe on a different pin from the link
 * sitting directly above it.
 *
 * Order of truth: coordinates carried by the stored pin link, then the
 * reconciled `latitude`/`longitude` columns, then the address text.
 */
export function propertyMapPin(source: PropertyMapPinSource): PropertyMapPin | null {
  const link = (source.google_map_link || "").trim();
  const coordinates =
    (link ? extractCoordinatesFromMapUrl(link) : null) ??
    toCoordinates(source.latitude ?? NaN, source.longitude ?? NaN);

  if (coordinates) {
    const pair = `${coordinates.latitude},${coordinates.longitude}`;
    return {
      mapUrl: googleMapsUrlForCoordinates(coordinates.latitude, coordinates.longitude),
      embedUrl: `https://maps.google.com/maps?q=${pair}&z=16&output=embed`,
      coordinates,
    };
  }

  const address = addressQuery(source);
  if (link) {
    return {
      mapUrl: link,
      embedUrl: address
        ? `https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`
        : null,
      coordinates: null,
    };
  }
  if (!address) return null;
  return {
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    embedUrl: `https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`,
    coordinates: null,
  };
}
