import { createBrowserClient } from '@supabase/ssr'
import { navigatorLock, NavigatorLockAcquireTimeoutError } from '@supabase/auth-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

// How long to wait for the cross-tab auth Web Lock before giving up and
// running the operation lock-less. Must stay BELOW the AuthProvider's 3s
// getSession safety timer — the fallback has to deliver the session
// before that timer gives up with user=null and the shell redirects.
const LOCK_ACQUIRE_TIMEOUT_MS = 2_000

/**
 * navigatorLock wrapper that can never wedge the app.
 *
 * auth-js serialises token reads/refreshes across tabs behind a
 * navigator.locks Web Lock. When another tab of this origin hangs
 * mid-refresh (mobile network switch, suspended background tab) and
 * never releases the lock, every auth call here — getSession included —
 * fails with NavigatorLockAcquireTimeoutError after lockAcquireTimeout.
 * The AuthProvider then reads that as "no user", the shell bounces to
 * /login, the middleware sees the still-valid cookie and bounces back
 * to /dashboard, and the app loops on the "Loading..." spinner until
 * the user closes the tab (which is what finally releases the lock).
 *
 * Instead of surfacing the timeout we run the operation WITHOUT the
 * lock. Worst case two tabs refresh the same token concurrently —
 * Supabase's refresh-token reuse grace interval absorbs that — which is
 * far better than an unrecoverable redirect loop.
 *
 * acquireTimeout === 0 means "skip if busy" (ifAvailable) — those
 * callers expect the timeout error and are delegated unchanged.
 */
async function resilientNavigatorLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  if (acquireTimeout === 0) return navigatorLock(name, 0, fn)
  // Cap every wait at LOCK_ACQUIRE_TIMEOUT_MS. In practice acquireTimeout
  // arrives as `undefined` here (supabase-js explicitly forwards its
  // destructured-but-unset lockAcquireTimeout, clobbering auth-js's 5000
  // default in the settings merge), and navigatorLock only arms its
  // abort timer for values > 0 — undefined/NaN/-1 all mean "wait
  // forever", which is exactly the wedge we're fixing.
  const waitMs =
    Number.isFinite(acquireTimeout) && acquireTimeout > 0
      ? Math.min(acquireTimeout, LOCK_ACQUIRE_TIMEOUT_MS)
      : LOCK_ACQUIRE_TIMEOUT_MS
  try {
    return await navigatorLock(name, waitMs, fn)
  } catch (err) {
    if (err instanceof NavigatorLockAcquireTimeoutError) {
      console.warn(
        `[supabase] auth lock "${name}" still held after ${waitMs}ms — proceeding without lock`,
      )
      return fn()
    }
    throw err
  }
}

export function createClient() {
  if (browserClient) return browserClient

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        lock: resilientNavigatorLock,
      },
    }
  )

  return browserClient
}
