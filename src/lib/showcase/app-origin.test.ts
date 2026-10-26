import { afterEach, describe, expect, it } from 'vitest';
import { appOrigin, isAppSiteOrigin } from './app-origin';

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe('appOrigin', () => {
  it('[PRP-053] is the configured site URL without a trailing slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.convoreal.com/';
    expect(appOrigin()).toBe('https://www.convoreal.com');
  });

  it('[PRP-053] falls back to the brand website', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(appOrigin()).toBe('https://www.convoreal.com');
  });
});

describe('isAppSiteOrigin', () => {
  it('[PRP-053] accepts the app origin and one label under the base domain over https', () => {
    expect(isAppSiteOrigin('https://www.convoreal.com')).toBe(true);
    expect(isAppSiteOrigin('https://aryavartaventures.convoreal.com')).toBe(
      true
    );
    expect(isAppSiteOrigin('https://convoreal.com')).toBe(true);
    expect(isAppSiteOrigin('HTTPS://Aryavarta.ConvoReal.com')).toBe(true);
  });

  it('[PRP-053] refuses every other origin', () => {
    expect(isAppSiteOrigin(null)).toBe(false);
    expect(isAppSiteOrigin('')).toBe(false);
    expect(isAppSiteOrigin('http://aryavartaventures.convoreal.com')).toBe(
      false
    );
    expect(isAppSiteOrigin('https://convoreal.com.evil.com')).toBe(false);
    expect(isAppSiteOrigin('https://evilconvoreal.com')).toBe(false);
    expect(isAppSiteOrigin('https://a.b.convoreal.com')).toBe(false);
    expect(isAppSiteOrigin('https://www.convoreal.com.')).toBe(false);
    expect(isAppSiteOrigin('null')).toBe(false);
  });

  it('[PRP-053] accepts a non-https app origin only when it is the configured one', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    expect(isAppSiteOrigin('http://localhost:3000')).toBe(true);
    expect(isAppSiteOrigin('http://localhost:3001')).toBe(false);
  });
});
