import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  addWidget,
  DEFAULT_WIDGETS,
  moveWidget,
  normalizeWidgetIds,
  removeWidget,
  type WidgetId,
} from '@/lib/home-widgets';

interface HomeWidgetState {
  /** Widgets pinned to the Overview dashboard, in display order (persisted). */
  ids: WidgetId[];
  add: (id: WidgetId) => void;
  remove: (id: WidgetId) => void;
  move: (id: WidgetId, direction: 'up' | 'down') => void;
}

export const useHomeWidgets = create<HomeWidgetState>()(
  persist(
    (set) => ({
      ids: [...DEFAULT_WIDGETS],
      add: (id) => set((s) => ({ ids: addWidget(s.ids, id) })),
      remove: (id) => set((s) => ({ ids: removeWidget(s.ids, id) })),
      move: (id, direction) => set((s) => ({ ids: moveWidget(s.ids, id, direction) })),
    }),
    {
      name: 'home-widgets',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ ids: s.ids }),
      // Stored ids may come from an older/newer build with a different
      // widget registry — sanitize instead of trusting the JSON blob.
      merge: (persisted, current) => ({
        ...current,
        ids: normalizeWidgetIds((persisted as { ids?: unknown } | null)?.ids),
      }),
    }
  )
);
