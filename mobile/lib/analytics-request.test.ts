import { describe, expect, it, vi } from 'vitest';

import {
  AnalyticsTimeoutError,
  retryAnalyticsRequest,
  withAnalyticsTimeout,
} from './analytics-request';

describe('withAnalyticsTimeout', () => {
  it('returns the underlying result before the deadline', async () => {
    await expect(
      withAnalyticsTimeout(Promise.resolve('ready'), 'Pulse', 100)
    ).resolves.toBe('ready');
  });

  it('rejects a request that never settles', async () => {
    vi.useFakeTimers();
    const pending = withAnalyticsTimeout(new Promise(() => {}), 'Pulse', 10);
    const assertion = expect(pending).rejects.toThrow('Pulse timed out');

    vi.advanceTimersByTime(10);
    await assertion;
    vi.useRealTimers();
  });

  it('does not retry a request after its deadline', () => {
    expect(retryAnalyticsRequest(0, new AnalyticsTimeoutError('Pulse'))).toBe(
      false
    );
  });

  it('preserves the shared retry limit for other failures', () => {
    const error = new Error('Network unavailable');

    expect(retryAnalyticsRequest(0, error)).toBe(true);
    expect(retryAnalyticsRequest(1, error)).toBe(true);
    expect(retryAnalyticsRequest(2, error)).toBe(false);
  });
});
