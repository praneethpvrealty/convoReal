import { onlineManager } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { ENV } from './env';
import {
  OFFLINE_PROBE_INTERVAL_MS,
  OFFLINE_PROBE_TIMEOUT_MS,
} from './online-state';
import { reportConnectivity } from './tracked-fetch';

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
    const unsubscribe = onlineManager.subscribe(sync);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !onlineManager.isOnline()) void probe();
    });
    sync(onlineManager.isOnline());
    return () => {
      unsubscribe();
      appState.remove();
      if (timer) clearInterval(timer);
    };
  }, []);
}

const subscribeOnline = (onChange: () => void) =>
  onlineManager.subscribe(onChange);
const getOnline = () => onlineManager.isOnline();

export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnline, getOnline);
}
