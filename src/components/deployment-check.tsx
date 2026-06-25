'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Detects when the browser is running JS from an older deployment
 * while the server has already been updated (common on Vercel).
 *
 * Next.js exposes `window.__NEXT_DATA__.buildId` on every page.
 * We poll /api/build-id (a tiny endpoint that returns the current
 * server build ID) and force a reload when they diverge.
 */
export function DeploymentCheck() {
  useEffect(() => {
    // Only run in production
    if (process.env.NODE_ENV !== 'production') return;

    const clientBuildId =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__NEXT_DATA__?.buildId as string | undefined;

    if (!clientBuildId) return;

    const check = async () => {
      try {
        const res = await fetch('/api/build-id', { cache: 'no-store' });
        if (!res.ok) return;
        const { buildId: serverBuildId } = await res.json();

        if (serverBuildId && serverBuildId !== clientBuildId) {
          toast.info('A new version is available. Refreshing...', {
            duration: 3000,
          });
          setTimeout(() => window.location.reload(), 3000);
        }
      } catch {
        // Silently ignore network errors
      }
    };

    // Check immediately, then every 5 minutes
    check();
    const interval = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return null;
}
