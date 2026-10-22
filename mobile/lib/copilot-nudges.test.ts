import { describe, expect, it } from 'vitest';
import {
  nudgeCtaTarget,
  nudgeLastShownKey,
  nudgeSeenKey,
} from './copilot-nudges';

const APP: Record<string, string> = {
  '/inbox': '/(app)/(tabs)',
  '/dashboard': '/(app)/dashboard',
};
const resolve = (route: string) => APP[route] ?? null;

describe('mobile nudges [ONB-002]', () => {
  it('keys cooldowns per account', () => {
    expect(nudgeLastShownKey('acc-1')).toBe('copilot-nudge-last-shown:acc-1');
    expect(nudgeSeenKey('acc-1')).toBe('copilot-nudge-seen:acc-1');
  });

  it('runs a ported tour natively and sends a desktop-only one to the web', () => {
    expect(
      nudgeCtaTarget({ label: 'x', tourId: 'add-contact' }, resolve)
    ).toEqual({ kind: 'tour', tourId: 'add-contact' });
    expect(
      nudgeCtaTarget({ label: 'x', tourId: 'connect-whatsapp' }, resolve)
    ).toEqual({ kind: 'web', path: '/dashboard' });
  });

  it('opens a mapped web route natively and the rest on the web', () => {
    expect(nudgeCtaTarget({ label: 'x', href: '/inbox' }, resolve)).toEqual({
      kind: 'app',
      href: '/(app)/(tabs)',
    });
    expect(
      nudgeCtaTarget({ label: 'x', href: '/dashboard?tab=radar' }, resolve)
    ).toEqual({ kind: 'app', href: '/(app)/dashboard' });
    expect(
      nudgeCtaTarget({ label: 'x', href: '/settings?tab=showcase' }, resolve)
    ).toEqual({ kind: 'web', path: '/settings?tab=showcase' });
    expect(nudgeCtaTarget({ label: 'x' }, resolve)).toBeNull();
  });
});
