/**
 * Whether a native MapView can draw tiles. Pure so it can be tested
 * without Expo; lib/maps-support.ts feeds it the running app's values.
 *
 * Android draws Google Maps, which removed itself from Expo Go (SDK 53+)
 * and needs GOOGLE_MAPS_ANDROID_API_KEY baked into the build. A build
 * without the key shows a black canvas with only the Google logo, so
 * app.config.js marks the builds that have one in `extra`, which, unlike
 * `android.config`, survives into the runtime config. iOS draws Apple
 * Maps and needs neither.
 */
export function canDrawNativeMaps(app: {
  os: string;
  executionEnvironment: string | undefined;
  googleMapsConfigured: unknown;
}): boolean {
  if (app.os !== 'android') return true;
  if (app.executionEnvironment === 'storeClient') return false;
  return app.googleMapsConfigured === true;
}
