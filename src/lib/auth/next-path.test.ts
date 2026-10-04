import { describe, expect, it } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/buyer/matches', '/buyer/matches'],
    [
      '/buyer/verify-phone?next=%2Fbuyer%2Fmatches',
      '/buyer/verify-phone?next=%2Fbuyer%2Fmatches',
    ],
    ['/den/verify-phone', '/den/verify-phone'],
    ['/inventory?propertyId=abc#photos', '/inventory?propertyId=abc#photos'],
  ])('keeps the on-site path %j', (next, expected) => {
    expect(safeNextPath(next, '/dashboard')).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    '@evil.example/x',
    '.evil.example/x',
    'evil.example',
    'https://evil.example/x',
    'javascript:alert(1)',
    '//evil.example/x',
    '/\\evil.example/x',
    '/\t/evil.example/x',
    '/..//evil.example/x',
    '/buyer/..//evil.example/x',
    '/buyer/..\\..\\/evil.example',
  ])('falls back for %j', (next) => {
    expect(safeNextPath(next, '/dashboard')).toBe('/dashboard');
  });

  it('never returns a value that resolves off the site', () => {
    const site = 'https://www.convoreal.com';
    for (const next of [
      '@evil.example/x',
      '.evil.example/x',
      '//evil.example/x',
      '/\\evil.example/x',
      '/buyer/..//evil.example/x',
      '/buyer/\\\\evil.example',
      '/%2F%2Fevil.example',
    ]) {
      const path = safeNextPath(next, '/dashboard');
      expect(new URL(path, site).origin).toBe(site);
      expect(new URL(`${site}${path}`).origin).toBe(site);
    }
  });

  describe('within a section', () => {
    it.each([
      ['/buyer', '/buyer'],
      ['/buyer/matches', '/buyer/matches'],
      ['/buyer/matches?tab=new', '/buyer/matches?tab=new'],
      ['/buyer/shortlist/../matches', '/buyer/matches'],
    ])('keeps %j', (next, expected) => {
      expect(safeNextPath(next, '/buyer', '/buyer')).toBe(expected);
    });

    it.each([
      '/dashboard',
      '/buyerx',
      '/buyer/../dashboard',
      '/buyer/%2e%2e/api/x',
      '/buyer/..\\dashboard',
      '/den',
    ])('falls back for %j, which leaves the section', (next) => {
      expect(safeNextPath(next, '/buyer', '/buyer')).toBe('/buyer');
    });
  });
});
