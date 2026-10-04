'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { Property } from '@/types';
import { readStored, writeStored } from '@/lib/safe-storage';
import {
  MAX_SHORTLIST_PROPERTIES,
  readShortlistIds,
} from '@/lib/showcase/shortlist';

const memorySelections = new Map<string, string>();
const changeEvent = 'showcase-shortlist-change';
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(changeEvent, listener);
  };
}
const serverSnapshot = () => null;

export function useShowcaseShortlist(
  accountId: string,
  properties: Property[]
) {
  const storageKey = `showcase_shortlist:${accountId}`;
  const getSnapshot = useCallback(
    () => memorySelections.get(storageKey) ?? readStored(storageKey),
    [storageKey]
  );
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const ids = useMemo(
    () =>
      readShortlistIds(
        raw,
        properties.map((property) => property.id)
      ),
    [raw, properties]
  );
  const selected = ids.flatMap(
    (id) => properties.find((property) => property.id === id) ?? []
  );
  function save(next: string[]) {
    const value = JSON.stringify(next);
    if (writeStored(storageKey, value)) memorySelections.delete(storageKey);
    else memorySelections.set(storageKey, value);
    window.dispatchEvent(new Event(changeEvent));
  }
  function toggle(id: string) {
    if (!properties.some((property) => property.id === id)) return;
    if (ids.includes(id)) return save(ids.filter((item) => item !== id));
    if (ids.length >= MAX_SHORTLIST_PROPERTIES) {
      toast.error(
        `Shortlist up to ${MAX_SHORTLIST_PROPERTIES} properties at a time.`
      );
      return;
    }
    save([...ids, id]);
  }
  return { ids, selected, toggle, clear: () => save([]) };
}
