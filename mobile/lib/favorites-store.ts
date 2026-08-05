import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  normalizeFavorites,
  toggleFavorite,
  type MenuRouteId,
} from '@/lib/menu';

/**
 * Menu destinations the user pinned to the top of More.
 *
 * Device-local, like the web sidebar's favourites (which live in
 * localStorage) — starring on the phone does not change the desktop
 * list and vice versa. Moving both onto the account would need a
 * migration and a synced store; see docs/mobile-desktop-flow-gaps.md.
 */
interface FavoritesState {
  ids: MenuRouteId[];
  toggle: (id: MenuRouteId) => void;
}

export const useFavorites = create<FavoritesState>()(
  persist(
    (set) => ({
      ids: [],
      toggle: (id) => set((s) => ({ ids: toggleFavorite(s.ids, id) })),
    }),
    {
      name: 'menu-favorites',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ ids: s.ids }),
      // Stored ids may come from a build with a different menu registry
      // — sanitize instead of trusting the JSON blob.
      merge: (persisted, current) => ({
        ...current,
        ids: normalizeFavorites((persisted as { ids?: unknown } | null)?.ids),
      }),
    }
  )
);
