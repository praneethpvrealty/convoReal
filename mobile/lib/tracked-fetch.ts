import { nextOnline, type ConnectivityEvent } from './online-state';

let online = true;
const listeners = new Set<(online: boolean) => void>();

export function isConnected(): boolean {
  return online;
}

export function subscribeConnectivity(
  listener: (online: boolean) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportConnectivity(event: ConnectivityEvent) {
  const next = nextOnline(online, event);
  if (next === online) return;
  online = next;
  for (const listener of listeners) listener(next);
}

export const trackedFetch: typeof fetch = async (input, init) => {
  try {
    const res = await fetch(input, init);
    reportConnectivity({ kind: 'response' });
    return res;
  } catch (err) {
    reportConnectivity({ kind: 'request-failed', error: err });
    throw err;
  }
};
