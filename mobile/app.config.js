/**
 * Dynamic config over app.json: injects the Google Maps Android key
 * at build time (EAS reads it from the environment / secrets). The
 * key cannot work in Expo Go — see lib/maps-support.ts — so it is
 * only attached when present.
 */
module.exports = ({ config }) => {
  const key = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  if (!key) return config;
  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...(config.android?.config ?? {}),
        googleMaps: { apiKey: key },
      },
    },
  };
};
