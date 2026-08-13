// ============================================================
// Web storage that cannot take the page down with it.
//
// A visitor with site data blocked in Chrome does NOT get null back
// from `localStorage` — reading the property itself throws
// SecurityError ("Access is denied for this document"). One unguarded
// read during mount therefore takes out the whole React tree.
//
// That is not hypothetical: a co-broker opened a showcase link on
// Android Chrome and got the error page every time, on a URL that
// served a correct 200 with every chunk present, while the same link
// worked for everyone else. The setting is per-site and sticky, so to
// him the product was simply broken.
//
// Storage is a convenience everywhere it is used here — a remembered
// filter, a draft, a theme. Losing it is a worse session; throwing is a
// blank page. These helpers degrade to the former.
// ============================================================

type Backing = 'local' | 'session';

function store(which: Backing): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    // The property access is the part that throws, so it has to be
    // inside the try — not the method call on it.
    return which === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads a key, or null when storage is unavailable or blocked. */
export function readStored(
  key: string,
  which: Backing = 'local'
): string | null {
  try {
    return store(which)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Writes a key. Returns false when the write did not happen — blocked
 *  storage, or a quota that is already full. */
export function writeStored(
  key: string,
  value: string,
  which: Backing = 'local'
): boolean {
  try {
    const s = store(which);
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Removes a key. Silent when storage is unavailable. */
export function removeStored(key: string, which: Backing = 'local'): void {
  try {
    store(which)?.removeItem(key);
  } catch {
    // Nothing to clean up if we could not reach storage at all.
  }
}

/** Reads and JSON-parses a key. Returns `fallback` when the key is
 *  absent, storage is blocked, or the stored value is not valid JSON —
 *  a corrupt entry is as fatal as a blocked one if it is not caught. */
export function readStoredJson<T>(
  key: string,
  fallback: T,
  which: Backing = 'local'
): T {
  const raw = readStored(key, which);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** True when storage can actually be used. For deciding whether to
 *  tell someone their preferences will not be remembered — never as a
 *  guard before the helpers above, which are safe regardless. */
export function storageAvailable(which: Backing = 'local'): boolean {
  return store(which) !== null;
}
