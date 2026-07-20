import { useQuery } from '@tanstack/react-query';

import { apiFetch } from './api';

export interface AppConfig {
  branding: { name: string };
  /** Credit prices per AI feature (AI_FEATURE_COSTS on the web). */
  ai_costs: Record<string, number>;
}

/**
 * Deployment-level config from GET /api/config — the mobile bundle
 * can't read the web app's NEXT_PUBLIC_* env, so branding and credit
 * costs come over the wire. Persisted with the query cache, so it's
 * available offline after the first fetch; callers keep a sensible
 * fallback for the very first run.
 */
export function useAppConfig(): AppConfig | undefined {
  const { data } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => apiFetch<{ data: AppConfig }>('/api/config').then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  });
  return data;
}
