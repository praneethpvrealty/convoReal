import { describe, expect, it } from 'vitest';
import { buildCopilotScaffold, isAllowedRoute } from './knowledge';
import { kbVersionFor } from './qa-cache';
import {
  MOBILE_APP_ROUTES,
  parseCoverage,
  parsePlatform,
  webUrlFor,
} from './platform';

describe('platform parsing', () => {
  it('defaults everything but "mobile" to web', () => {
    expect(parsePlatform('mobile')).toBe('mobile');
    expect(parsePlatform('web')).toBe('web');
    expect(parsePlatform(undefined)).toBe('web');
    expect(parsePlatform('ios')).toBe('web');
  });

  it('accepts only the four coverage verdicts', () => {
    expect(parseCoverage('full')).toBe('full');
    expect(parseCoverage('web_only')).toBe('web_only');
    expect(parseCoverage('partial')).toBe('partial');
    expect(parseCoverage('none')).toBe('none');
    expect(parseCoverage('desktop')).toBeNull();
    expect(parseCoverage(null)).toBeNull();
  });

  it('builds desktop URLs from dashboard paths only', () => {
    expect(webUrlFor('/settings').endsWith('/settings')).toBe(true);
    expect(webUrlFor(undefined)).toBe(webUrlFor(null));
    expect(webUrlFor('https://evil.example')).toBe(webUrlFor(undefined));
  });

  it('lists only real agent routes as mobile-available', () => {
    for (const route of MOBILE_APP_ROUTES) {
      expect(isAllowedRoute(route, 'agent'), route).toBe(true);
    }
  });
});

describe('mobile scaffold', () => {
  it('appends the app directory and coverage contract for mobile only', () => {
    const web = buildCopilotScaffold('/', 'agent', 'web');
    const mobile = buildCopilotScaffold('/', 'agent', 'mobile');
    expect(web).not.toContain('MOBILE APP');
    expect(web).not.toContain('"coverage"');
    expect(mobile).toContain('MOBILE APP');
    expect(mobile).toContain('"coverage"');
    expect(mobile).toContain('desktop web only — never set this tourId');
  });

  it('partitions the answer cache per platform for agents only', () => {
    expect(kbVersionFor('agent', 'mobile')).not.toBe(kbVersionFor('agent'));
    expect(kbVersionFor('agent', 'web')).toBe(kbVersionFor('agent'));
    expect(kbVersionFor('owner', 'mobile')).toBe(kbVersionFor('owner'));
  });
});
