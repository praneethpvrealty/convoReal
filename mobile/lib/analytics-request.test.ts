import { describe, expect, it, vi } from 'vitest';

import { withAnalyticsTimeout } from './analytics-request';

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
});
