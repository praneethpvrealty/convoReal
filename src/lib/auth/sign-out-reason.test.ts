import { describe, expect, it } from 'vitest';

import { SIGN_OUT_REASON_NOTICES, parseSignOutReason } from './sign-out-reason';

describe('[ACC-010] sign-out reasons', () => {
  it('reads only a known reason', () => {
    expect(parseSignOutReason('expired')).toBe('expired');
    expect(parseSignOutReason('EXPIRED')).toBeNull();
    expect(parseSignOutReason(null)).toBeNull();
    expect(parseSignOutReason('<script>')).toBeNull();
  });

  it('says why the user was signed out', () => {
    expect(SIGN_OUT_REASON_NOTICES.expired).toBe(
      'Your session expired — sign in again.'
    );
  });
});
