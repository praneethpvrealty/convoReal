import { useEffect, useState } from 'react';

/**
 * The one debounce for search inputs. 250ms matches typing cadence
 * without feeling laggy; every screen uses the same delay so sibling
 * tabs don't feel different.
 */
export function useDebounced(value: string, ms = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
