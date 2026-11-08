import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

import { canDrawNativeMaps } from './maps-availability';

const require = createRequire(import.meta.url);
const appConfig = require('../app.config.js') as (input: {
  config: Record<string, unknown>;
}) => Record<string, any>;
const fingerprintConfig = require('../fingerprint.config.js') as {
  fileHookTransform: (
    source: { type: string; id: string },
    chunk: Buffer | string | null
  ) => Buffer | string | null;
};

const base = {
  name: 'ConvoReal',
  android: { package: 'com.convoreal.app' },
  extra: { eas: { projectId: 'p1' } },
};

function hashedConfig(config: Record<string, unknown>): string {
  return String(
    fingerprintConfig.fileHookTransform(
      { type: 'contents', id: 'expoConfig' },
      JSON.stringify(config)
    )
  );
}

describe('[PRP-056] native maps draw only where they can', () => {
  const saved = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.GOOGLE_MAPS_ANDROID_API_KEY;
    else process.env.GOOGLE_MAPS_ANDROID_API_KEY = saved;
  });

  it('falls back on an Android build without a Maps key instead of a black canvas', () => {
    expect(
      canDrawNativeMaps({
        os: 'android',
        executionEnvironment: 'standalone',
        googleMapsConfigured: undefined,
      })
    ).toBe(false);
    expect(
      canDrawNativeMaps({
        os: 'android',
        executionEnvironment: 'standalone',
        googleMapsConfigured: true,
      })
    ).toBe(true);
  });

  it('falls back in Expo Go on Android, and always draws Apple Maps on iOS', () => {
    expect(
      canDrawNativeMaps({
        os: 'android',
        executionEnvironment: 'storeClient',
        googleMapsConfigured: true,
      })
    ).toBe(false);
    expect(
      canDrawNativeMaps({
        os: 'ios',
        executionEnvironment: 'storeClient',
        googleMapsConfigured: undefined,
      })
    ).toBe(true);
  });

  it('flags the runtime config exactly when the build carries the key', () => {
    process.env.GOOGLE_MAPS_ANDROID_API_KEY = 'test-key';
    const withKey = appConfig({ config: base });
    expect(withKey.android.config.googleMaps.apiKey).toBe('test-key');
    expect(withKey.extra.googleMapsConfigured).toBe(true);
    expect(withKey.extra.eas.projectId).toBe('p1');

    delete process.env.GOOGLE_MAPS_ANDROID_API_KEY;
    const withoutKey = appConfig({ config: base });
    expect(withoutKey.android.config).toBeUndefined();
    expect(withoutKey.extra.googleMapsConfigured).toBeUndefined();
  });

  it('keeps the flag out of the runtime fingerprint so installed builds still take updates', () => {
    process.env.GOOGLE_MAPS_ANDROID_API_KEY = 'test-key';
    const flagged = appConfig({ config: base });
    const { googleMapsConfigured, ...extra } = flagged.extra;
    expect(googleMapsConfigured).toBe(true);
    expect(hashedConfig(flagged)).toBe(hashedConfig({ ...flagged, extra }));
    expect(hashedConfig(flagged)).toContain('test-key');
  });
});
