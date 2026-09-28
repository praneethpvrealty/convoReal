import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { normalizeJourneyEnquirySource } from '@/lib/journey-overview';

type JourneyMode = 'buyer' | 'property';

const storageKey = (mode: JourneyMode) => `journey_overview_source_${mode}`;

export function useRememberedJourneySource(mode: JourneyMode) {
  const [sources, setSources] = useState<
    Partial<Record<JourneyMode, string | null>>
  >({});

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey(mode))
      .then((stored) => {
        if (cancelled) return;
        setSources((current) =>
          mode in current
            ? current
            : { ...current, [mode]: normalizeJourneyEnquirySource(stored) }
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const setSource = useCallback(
    (source: string | null) => {
      setSources((current) => ({ ...current, [mode]: source }));
      (source
        ? AsyncStorage.setItem(storageKey(mode), source)
        : AsyncStorage.removeItem(storageKey(mode))
      ).catch(() => {});
    },
    [mode]
  );

  return [sources[mode] ?? null, setSource] as const;
}
