import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { trackedFetch } from '@/lib/tracked-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

describe('[UIX-010] app requests drive the online state', () => {
  it('goes offline when a request never reaches a server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed');
      })
    );
    await expect(trackedFetch('https://api.test/x')).rejects.toThrow();
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('comes back online on the next response of any status', async () => {
    onlineManager.setOnline(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 500 }) as Response)
    );
    await trackedFetch('https://api.test/x');
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('stays online when a request is aborted', async () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw abort;
      })
    );
    await expect(trackedFetch('https://api.test/x')).rejects.toBe(abort);
    expect(onlineManager.isOnline()).toBe(true);
  });
});
