import { describe, expect, it } from 'vitest';

import { isDefinitiveAuthFailure } from '@/lib/session-expiry';

describe('[ACC-010] only a definitive auth failure ends the session', () => {
  it('signs out when GoTrue refuses the refresh token', () => {
    expect(
      isDefinitiveAuthFailure({
        name: 'AuthApiError',
        status: 400,
        code: 'refresh_token_not_found',
        message: 'Invalid Refresh Token: Refresh Token Not Found',
      })
    ).toBe(true);
    expect(isDefinitiveAuthFailure({ name: 'AuthApiError', status: 401 })).toBe(
      true
    );
  });

  it('signs out when no session is stored at all', () => {
    expect(isDefinitiveAuthFailure({ name: 'AuthSessionMissingError' })).toBe(
      true
    );
    expect(isDefinitiveAuthFailure(null)).toBe(true);
  });

  it('keeps the session through a network failure or an outage', () => {
    expect(
      isDefinitiveAuthFailure({
        name: 'AuthRetryableFetchError',
        status: 0,
        message: 'Network request failed',
      })
    ).toBe(false);
    expect(
      isDefinitiveAuthFailure({ name: 'AuthRetryableFetchError', status: 503 })
    ).toBe(false);
    expect(
      isDefinitiveAuthFailure({ name: 'AuthUnknownError', message: 'oops' })
    ).toBe(false);
    expect(isDefinitiveAuthFailure({ name: 'AuthApiError', status: 429 })).toBe(
      false
    );
    expect(isDefinitiveAuthFailure({ name: 'AuthApiError', status: 500 })).toBe(
      false
    );
  });
});
