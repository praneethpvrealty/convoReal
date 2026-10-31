import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isConnected,
  reportConnectivity,
  trackedFetch,
} from '@/lib/tracked-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
  reportConnectivity({ kind: 'response' });
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
    expect(isConnected()).toBe(false);
  });

  it('comes back online on the next response of any status', async () => {
    reportConnectivity({ kind: 'probe', reachable: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 500 }) as Response)
    );
    await trackedFetch('https://api.test/x');
    expect(isConnected()).toBe(true);
  });

  it('never pauses react-query while showing offline', async () => {
    const { onlineManager } = await import('@tanstack/react-query');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed');
      })
    );
    await expect(trackedFetch('https://api.test/x')).rejects.toThrow();
    expect(isConnected()).toBe(false);
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
    expect(isConnected()).toBe(true);
  });
});
