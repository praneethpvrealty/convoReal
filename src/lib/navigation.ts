/**
 * Same-pathname-safe client navigation.
 *
 * On this Next.js version the app router silently swallows client
 * transitions whose target PATHNAME equals the current one (only the
 * search params differ) in production builds — router.push,
 * router.replace, and <Link> all no-op. Dev mode works, so the bug
 * only appears on deployed builds. Reproduced with a Playwright
 * harness against `next start`; the native History API is the
 * reliable path: Next syncs pushState/replaceState into
 * useSearchParams/usePathname, so pages re-render correctly and
 * back/forward keep working.
 *
 * Every tab switcher and URL-synced filter in the app routes through
 * these helpers: same-pathname targets go through the History API,
 * anything else falls back to the router as usual.
 */

import type { useRouter } from "next/navigation";

type AppRouter = ReturnType<typeof useRouter>;

function targetPathname(url: string): string {
  return url.split(/[?#]/)[0];
}

function isSamePathname(url: string): boolean {
  return (
    typeof window !== "undefined" &&
    targetPathname(url) === window.location.pathname
  );
}

/** push semantics — adds a history entry (tab switches, deep links). */
export function pushUrl(router: AppRouter, url: string): void {
  if (isSamePathname(url)) {
    window.history.pushState(null, "", url);
  } else {
    router.push(url, { scroll: false });
  }
}

/** replace semantics — no history entry (URL-synced filter state). */
export function replaceUrl(router: AppRouter, url: string): void {
  if (isSamePathname(url)) {
    window.history.replaceState(null, "", url);
  } else {
    router.replace(url, { scroll: false });
  }
}
