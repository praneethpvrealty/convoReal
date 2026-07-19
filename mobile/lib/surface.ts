import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Which side of the app this device signed into: the staff CRM or
 * the owner-facing Owners Den. One Supabase session serves both —
 * the surface flag decides where an authenticated user lands.
 */
export type Surface = 'staff' | 'den';

interface SurfaceState {
  surface: Surface;
  setSurface: (surface: Surface) => void;
}

export const useSurface = create<SurfaceState>()(
  persist(
    (set) => ({
      surface: 'staff',
      setSurface: (surface) => set({ surface }),
    }),
    { name: 'surface', storage: createJSONStorage(() => AsyncStorage) }
  )
);
