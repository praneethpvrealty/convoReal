import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  normalizeJourneyEnquirySources,
  type JourneyFilterMode,
} from '@/lib/journey-overview';

/**
 * The enquiry source each Journeys tab was last filtered by, kept on
 * this device like the web overview's localStorage key
 * journey_overview_source_<mode>.
 */
interface JourneyFilterState {
  sources: Partial<Record<JourneyFilterMode, string>>;
  setSource: (mode: JourneyFilterMode, source: string | null) => void;
}

export const useJourneyFilters = create<JourneyFilterState>()(
  persist(
    (set) => ({
      sources: {},
      setSource: (mode, source) =>
        set((s) => {
          const sources = { ...s.sources };
          if (source) sources[mode] = source;
          else delete sources[mode];
          return { sources };
        }),
    }),
    {
      name: 'journey-filters',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ sources: s.sources }),
      merge: (persisted, current) => ({
        ...current,
        sources: normalizeJourneyEnquirySources(
          (persisted as { sources?: unknown } | null)?.sources
        ),
      }),
    }
  )
);
