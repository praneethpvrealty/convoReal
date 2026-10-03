import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import {
  BOARD_LAYOUT_STORAGE_KEY,
  DEFAULT_BOARD_LAYOUT,
  parseBoardLayout,
  type BoardLayout,
} from '@shared/lib/pipelines/board-layout';

export function useBoardLayout(): [BoardLayout, (next: BoardLayout) => void] {
  const [layout, setLayoutState] = useState<BoardLayout>(DEFAULT_BOARD_LAYOUT);
  const [chosen, setChosen] = useState(false);

  useEffect(() => {
    if (chosen) return;
    let cancelled = false;
    AsyncStorage.getItem(BOARD_LAYOUT_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled) setLayoutState(parseBoardLayout(stored));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chosen]);

  const setLayout = useCallback((next: BoardLayout) => {
    setChosen(true);
    setLayoutState(next);
    AsyncStorage.setItem(BOARD_LAYOUT_STORAGE_KEY, next).catch(() => {});
  }, []);

  return [layout, setLayout];
}
