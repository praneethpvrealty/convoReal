import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { normalizeJourneyEnquirySource } from '@/lib/journey-overview';

type JourneyMode = 'buyer' | 'property';

const storageKey = (accountId: string, mode: JourneyMode) =>
  `journey_overview_source_${accountId}_${mode}`;

export function useRememberedJourneySource(
  accountId: string | null | undefined,
  mode: JourneyMode
) {
  const key = accountId ? storageKey(accountId, mode) : null;
  const [sources, setSources] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then((stored) => {
        if (cancelled) return;
        setSources((current) =>
          key in current
            ? current
            : { ...current, [key]: normalizeJourneyEnquirySource(stored) }
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);

  const setSource = useCallback(
    (source: string | null) => {
      if (!key) return;
      setSources((current) => ({ ...current, [key]: source }));
      (source
        ? AsyncStorage.setItem(key, source)
        : AsyncStorage.removeItem(key)
      ).catch(() => {});
    },
    [key]
  );

  return [key ? (sources[key] ?? null) : null, setSource] as const;
}
