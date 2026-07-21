import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response.
 *
 * CSP ships as `Content-Security-Policy-Report-Only` so the browser
 * surfaces violations in the console without blocking anything — once
 * we have confidence nothing legit trips it (two deploys, a pass on
 * every route), flip the key to `Content-Security-Policy` to enforce.
 *
 * The rest of the headers are straight blocks, safe to enforce today:
 *   - HSTS: only meaningful on HTTPS (no-op on http://localhost).
 *   - X-Content-Type-Options / X-Frame-Options / Referrer-Policy:
 *     baseline OWASP hardening, no behavioural cost.
 *   - Permissions-Policy: we don't use camera / geolocation / payment /
 *     usb, so those stay denied — a supply-chain compromise or a
 *     forgotten plugin can't silently opt back in. Microphone IS used
 *     (Calendar's voice event logging, src/components/calendar/
 *     smart-add-bar.tsx via getUserMedia) so it's scoped to `self`
 *     rather than denied outright. An empty `microphone=()` here
 *     overrides any per-site browser permission the user grants —
 *     the page vetoes it before the browser prompt even matters — so
 *     don't blanket-deny it again without re-checking that feature.
 */
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its inline hydration script
      // and 'unsafe-eval' in dev + some production optimisations.
      // Nonce-based CSP is a later project.
      // connect.facebook.net serves the Meta Pixel loader used by the
      // Showcase (src/components/showcase/showcase-view.tsx).
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net",
      // Tailwind + inline style attributes on lots of components.
      "style-src 'self' 'unsafe-inline'",
      // Supabase public-bucket avatars, contact avatars (arbitrary
      // https URLs paste-able from the UI), OG images, data URLs for
      // tiny inline assets.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Supabase REST + realtime (WSS). Server-side Meta Graph calls do
      // not belong here; www.facebook.com is the Pixel's beacon target.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.facebook.com",
      // Unlisted YouTube embeds of listing videos on the Showcase,
      // plus the Supabase-storage MP4 fallback the <video> tag plays.
      "frame-src 'self' https://www.youtube-nocookie.com",
      "media-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
] as const;

const nextConfig: NextConfig = {
  /**
   * Allow HMR and dev resources from the local network IP so you can
   * access the dev server from other devices on the same network
   * (e.g. http://192.168.29.147:3000). Next.js 16 blocks cross-origin
   * dev access by default; this allowlist re-enables it safely.
   */
  allowedDevOrigins: ['192.168.29.147'],

  /**
   * Cache-Control policy.
   *
   * Why this exists:
   *   Hostinger's CDN was applying `s-maxage=31536000` (1 year) to
   *   prerendered HTML pages by default. When a new deploy shipped
   *   fresh Turbopack chunk hashes, the edge kept serving year-old
   *   HTML referencing chunk filenames that no longer existed on
   *   disk — result: HTML 200, every /_next/static/*.js and .css
   *   came back 404, the page rendered unstyled. Private/incognito
   *   did nothing because the cache is server-side.
   *
   * Strategy:
   *   - /_next/static/* — immutable for a year. Filenames are
   *     content-hashed, so a new build produces new filenames; the
   *     old ones are safe to keep indefinitely in caches.
   *   - /api/*          — no-store. API responses are per-user and
   *     must never be shared across requests at the edge.
   *   - Everything else — public, brief s-maxage + generous
   *     stale-while-revalidate. The edge serves instantly from cache
   *     for the first 5 min, then returns cached content while
   *     refreshing in the background for up to 24 h. A deploy's
   *     chunk-hash drift self-heals within ~5 min with no user-
   *     visible latency.
   *
   *   Note: dynamic dashboard routes (/inbox, /contacts, /pipelines,
   *   /broadcasts, etc.) are server-rendered per request — Next.js
   *   and Supabase auth already prevent them from being served
   *   from a shared cache. The s-maxage here is a ceiling; Next.js
   *   and auth middleware still set `private` / `no-store` for
   *   per-user responses.
   *
   * Security headers are appended via a separate catch-all rule
   * below — Next.js merges headers from every matching rule, so
   * they apply to every response regardless of which cache rule
   * matched.
   *
   * IMPORTANT — rule order matters: when multiple rules match the
   * same path and set the same header key, Next.js applies the
   * *last* matching rule (see headers() docs). The "/api/:path*"
   * no-store rule must therefore be declared AFTER the general
   * "/:path*" catch-all below, or the catch-all's cacheable
   * Cache-Control silently wins on every API route — which is
   * exactly what happened here previously (2026-07-07 incident).
   */
  async headers() {
    return [
      // Immutable chunk caching is PRODUCTION-ONLY: `next build` chunk
      // filenames are content-hashed so year-long caching is safe. In
      // `next dev` Turbopack reuses stable chunk names across rebuilds —
      // this header would make browsers cache dev chunks for a year and
      // serve stale code after every edit.
      ...(process.env.NODE_ENV === "production"
        ? [
            {
              source: "/_next/static/:path*",
              headers: [
                {
                  key: "Cache-Control",
                  value: "public, max-age=31536000, immutable",
                },
              ],
            },
          ]
        : []),
      {
        // Showcase root path (property listings).
        // The page is dynamic (reads headers + searchParams) so Next.js App
        // Router marks it private by default.  Edge CDN caching of HTML is
        // therefore unreliable for this route.  Data-layer caching is handled
        // in the page itself via unstable_cache (1 h TTL).  We keep the header
        // as a best-effort fallback for any static assets or edge middleware
        // that might still benefit.
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // /api/* MUST be the last rule that sets Cache-Control. Next.js
        // merges header rules by matching path, and "if two headers match
        // the same path and set the same key, the last one wins" — this
        // rule previously sat *before* the "/:path*" catch-all above, so
        // the catch-all's cacheable Cache-Control silently overrode this
        // no-store on every API route. Confirmed in prod: GET
        // /api/onboarding/status was served `s-maxage=300,
        // stale-while-revalidate=86400` instead of `no-store`, which is
        // how a stale "no properties yet" snapshot kept being served to
        // an account that already had properties. API responses are
        // per-user and must never be shared across requests at the edge.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // Security headers on every response, including /_next/static
        // assets (nosniff matters there) and /api/* (HSTS + referrer-
        // policy don't hurt).
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },

  async redirects() {
    const fromDomain = process.env.REDIRECT_FROM_DOMAIN;
    const toDomain = process.env.REDIRECT_TO_DOMAIN || 'convoreal.com';
    if (!fromDomain) return [];

    const escapedFrom = fromDomain.replace(/\./g, '\\.');

    return [
      // 1. Redirect main domain root and all paths
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: escapedFrom,
          },
        ],
        destination: `https://${toDomain}/:path*`,
        permanent: false,
      },
      // 1a. Redirect old crm subdomain to the new main apex domain
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: `crm\\.${escapedFrom}`,
          },
        ],
        destination: `https://${toDomain}/:path*`,
        permanent: false,
      },
      // 2. Redirect all subdomains (retaining subdomain slug)
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: `(?<subdomain>[^\\.]+)\\.${escapedFrom}`,
          },
        ],
        destination: `https://:subdomain.${toDomain}/:path*`,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
