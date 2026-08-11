import { describe, expect, it } from 'vitest';

import { contactHandle, hasEmail, hasPhone, isReachable } from './reachability';

describe('reachability', () => {
  it('treats a blank phone as no phone', () => {
    expect(hasPhone({ phone: '+919845164342' })).toBe(true);
    expect(hasPhone({ phone: '   ' })).toBe(false);
    expect(hasPhone({ phone: null })).toBe(false);
    expect(hasPhone({})).toBe(false);
  });

  it('treats a blank email as no email', () => {
    expect(hasEmail({ email: 'sales@brigade.com' })).toBe(true);
    expect(hasEmail({ email: '' })).toBe(false);
    expect(hasEmail({ email: null })).toBe(false);
  });

  it('needs one channel, not both', () => {
    expect(isReachable({ phone: '+919845164342' })).toBe(true);
    expect(isReachable({ email: 'sales@brigade.com' })).toBe(true);
    expect(isReachable({ phone: null, email: null })).toBe(false);
  });

  it('falls back to the email where a phone used to be printed', () => {
    expect(contactHandle({ phone: ' +919845164342 ', email: 'a@b.com' })).toBe(
      '+919845164342'
    );
    expect(contactHandle({ phone: null, email: ' a@b.com ' })).toBe('a@b.com');
    expect(contactHandle({})).toBe('');
  });
});
