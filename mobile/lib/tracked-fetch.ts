import { onlineManager } from '@tanstack/react-query';

import { nextOnline, type ConnectivityEvent } from './online-state';

/**
 * Connectivity without a native module: the app is offline when one of
 * its own requests fails before reaching a server, and online again on
 * the next response or a successful probe (see ./online). react-query's
 * onlineManager carries the state, so paused queries resume by
 * themselves once it flips back.
 */
export function reportConnectivity(event: ConnectivityEvent) {
  const current = onlineManager.isOnline();
  const next = nextOnline(current, event);
  if (next !== current) onlineManager.setOnline(next);
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
