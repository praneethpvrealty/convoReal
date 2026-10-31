export const OFFLINE_PROBE_INTERVAL_MS = 15_000;
export const OFFLINE_PROBE_TIMEOUT_MS = 8_000;

const NETWORK_FAILURE =
  /network request failed|failed to fetch|network ?error|internet connection appears to be offline|could not connect to the server|the network connection was lost/i;

/** True only for a request that never reached a server: the fetch
 *  rejected before any response. A response of any status, a timeout
 *  or a cancellation is not evidence that the device is offline. */
export function isNetworkFailure(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (typeof err === 'string') return NETWORK_FAILURE.test(err);
  if (typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (name === 'AbortError') return false;
  return typeof message === 'string' && NETWORK_FAILURE.test(message);
}

export type ConnectivityEvent =
  | { kind: 'response' }
  | { kind: 'request-failed'; error: unknown }
  | { kind: 'probe'; reachable: boolean };

export function nextOnline(online: boolean, event: ConnectivityEvent): boolean {
  switch (event.kind) {
    case 'response':
      return true;
    case 'request-failed':
      return isNetworkFailure(event.error) ? false : online;
    case 'probe':
      return event.reachable;
  }
}
