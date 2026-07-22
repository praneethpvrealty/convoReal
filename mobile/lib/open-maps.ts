import { Linking, Platform } from 'react-native';

/**
 * Open a location in the Google Maps app instead of the browser. Prefers
 * coordinates so it lands on the exact point: Android's `geo:` scheme
 * launches Google Maps directly; iOS tries the Google Maps app scheme,
 * then Apple Maps, then the web. Each candidate is attempted in turn and
 * the first that opens wins, so a device without the app still degrades
 * to a maps web page rather than failing.
 */
export async function openInMaps(opts: {
  latitude?: number | null;
  longitude?: number | null;
  label?: string | null;
  fallbackUrl?: string | null;
}): Promise<void> {
  const { latitude, longitude, label, fallbackUrl } = opts;
  const hasCoords = typeof latitude === 'number' && typeof longitude === 'number';
  const coords = hasCoords ? `${latitude},${longitude}` : '';
  const query = encodeURIComponent(label?.trim() || coords);
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${hasCoords ? coords : query}`;

  const candidates: string[] = [];
  if (Platform.OS === 'ios') {
    candidates.push(hasCoords ? `comgooglemaps://?q=${query}&center=${coords}` : `comgooglemaps://?q=${query}`);
    candidates.push(hasCoords ? `maps://?ll=${coords}&q=${query}` : `maps://?q=${query}`);
  } else {
    // Android: `geo:` opens the default maps app (Google Maps) directly.
    candidates.push(hasCoords ? `geo:${coords}?q=${coords}(${query})` : `geo:0,0?q=${query}`);
  }
  if (fallbackUrl) candidates.push(fallbackUrl);
  candidates.push(webUrl);

  for (const url of candidates) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // Try the next candidate.
    }
  }
}
