import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { ENV } from './env';
import {
  OFFLINE_PROBE_INTERVAL_MS,
  OFFLINE_PROBE_TIMEOUT_MS,
} from './online-state';
import {
  isConnected,
  reportConnectivity,
  subscribeConnectivity,
} from './tracked-fetch';

async function probe() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OFFLINE_PROBE_TIMEOUT_MS);
  try {
    await fetch(ENV.apiBaseUrl, { method: 'HEAD', signal: controller.signal });
    reportConnectivity({ kind: 'probe', reachable: true });
  } catch {
    reportConnectivity({ kind: 'probe', reachable: false });
  } finally {
    clearTimeout(timer);
  }
}

export function useOnlineTracking() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const sync = (online: boolean) => {
      if (online) {
        if (timer) clearInterval(timer);
        timer = null;
      } else if (!timer) {
        timer = setInterval(() => void probe(), OFFLINE_PROBE_INTERVAL_MS);
      }
    };
    const unsubscribe = subscribeConnectivity(sync);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !isConnected()) void probe();
    });
    sync(isConnected());
    return () => {
      unsubscribe();
      appState.remove();
      if (timer) clearInterval(timer);
    };
  }, []);
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isConnected, isConnected);
}
