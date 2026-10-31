import { describe, expect, it } from 'vitest';

import { isNetworkFailure, nextOnline } from '@/lib/online-state';

describe('[UIX-010] offline detection', () => {
  it('reads a fetch that never reached a server as a network failure', () => {
    expect(isNetworkFailure(new TypeError('Network request failed'))).toBe(
      true
    );
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(
      isNetworkFailure({ message: 'TypeError: Network request failed' })
    ).toBe(true);
  });

  it('does not read a timeout, cancellation or server error as offline', () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    expect(isNetworkFailure(abort)).toBe(false);
    expect(isNetworkFailure(new Error('Request failed (500)'))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });

  it('goes offline on a network failure and back online on any response', () => {
    const failed = nextOnline(true, {
      kind: 'request-failed',
      error: new TypeError('Network request failed'),
    });
    expect(failed).toBe(false);
    expect(nextOnline(failed, { kind: 'response' })).toBe(true);
  });

  it('keeps the current state when a request fails for another reason', () => {
    expect(
      nextOnline(false, { kind: 'request-failed', error: new Error('500') })
    ).toBe(false);
    expect(
      nextOnline(true, { kind: 'request-failed', error: new Error('500') })
    ).toBe(true);
  });

  it('follows the probe while offline', () => {
    expect(nextOnline(false, { kind: 'probe', reachable: true })).toBe(true);
    expect(nextOnline(false, { kind: 'probe', reachable: false })).toBe(false);
  });
});
