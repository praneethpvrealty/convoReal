'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  BOARD_LAYOUT_STORAGE_KEY,
  DEFAULT_BOARD_LAYOUT,
  parseBoardLayout,
  type BoardLayout,
} from '@/lib/pipelines/board-layout';
import { readStored, writeStored } from '@/lib/safe-storage';

/**
 * The Deals board layout this device last chose. The server render and
 * hydration use the default; the stored choice is read from the client
 * snapshot, so there is no hydration mismatch and no setState in an
 * effect. Other tabs pick a change up through the `storage` event.
 */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === BOARD_LAYOUT_STORAGE_KEY) {
      onChange();
    }
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

let unstoredLayout: BoardLayout | null = null;

function getSnapshot(): BoardLayout {
  const stored = readStored(BOARD_LAYOUT_STORAGE_KEY);
  if (stored === null && unstoredLayout) return unstoredLayout;
  return parseBoardLayout(stored);
}

function getServerSnapshot(): BoardLayout {
  return DEFAULT_BOARD_LAYOUT;
}

export function useBoardLayout(): [BoardLayout, (next: BoardLayout) => void] {
  const layout = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const setLayout = useCallback((next: BoardLayout) => {
    unstoredLayout = writeStored(BOARD_LAYOUT_STORAGE_KEY, next) ? null : next;
    listeners.forEach((listener) => listener());
  }, []);

  return [layout, setLayout];
}
