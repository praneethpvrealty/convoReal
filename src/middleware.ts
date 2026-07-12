/**
 * Next.js Middleware — Supabase Session Guard
 *
 * Runs on every request matching the `matcher` pattern below.
 * Primary jobs:
 *
 * 1. REFRESH — Call `supabase.auth.getUser()` so the SSR client can
 *    silently renew the session cookie before it expires. Without this
 *    the server-side client never refreshes cookies and the browser
 *    accumulates a stale refresh token.
 *
 * 2. CLEAR STALE TOKENS — When Supabase returns `refresh_token_not_found`
 *    (expired / revoked token) the middleware deletes the three Supabase
 *    auth cookies and redirects the user to /login. This prevents the
 *    error from flooding the server logs on every request.
 *
 * 3. AUTH GATE — Redirect unauthenticated visitors away from protected
 *    dashboard routes to /login.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Supabase auth cookie names (v2 token format). We clear all three on
// a stale-token error so the client starts completely fresh.
const SUPABASE_COOKIE_PREFIXES = [
  'sb-access-token',
  'sb-refresh-token',
  'sb-auth-token',
]

/**
 * Given a Response, delete all Supabase session cookies by setting
 * them with an expired Max-Age. Works on both `NextResponse` objects.
 */
function clearAuthCookies(res: NextResponse, req: NextRequest) {
  const all = req.cookies.getAll()
  for (const { name } of all) {
    if (
      SUPABASE_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
      // project-specific cookie format: sb-<ref>-auth-token
      name.includes('-auth-token')
    ) {
      res.cookies.set(name, '', { maxAge: 0, path: '/' })
    }
  }
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Propagate cookie changes to both the request (for later
          // middleware in the chain) and the response (sent to browser).
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          supabaseResponse = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  // IMPORTANT: getUser() makes a network request to Supabase to validate
  // the session. Do NOT use getSession() here — it trusts the JWT without
  // re-validating. This is the only way to detect revoked tokens server-side.
  const { data: { user }, error } = await supabase.auth.getUser()

  const url = request.nextUrl

  // ── Stale / revoked token ───────────────────────────────────────────
  // Clear cookies and send the user to /login so they can sign in fresh.
  // Without this the error repeats on every request until the user
  // manually clears their cookies.
  if (
    error &&
    (error.code === 'refresh_token_not_found' ||
      error.message?.includes('Refresh Token Not Found') ||
      error.message?.includes('Invalid Refresh Token'))
  ) {
    console.warn('[middleware] stale refresh token detected — clearing cookies and redirecting to /login')
    const loginUrl = url.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    const redirectResponse = NextResponse.redirect(loginUrl)
    clearAuthCookies(redirectResponse, request)
    return redirectResponse
  }

  // ── Auth gate ─────────────────────────────────────────────────────
  // Redirect unauthenticated visitors from dashboard routes to /login.
  const isDashboard = url.pathname.startsWith('/') &&
    !url.pathname.startsWith('/login') &&
    !url.pathname.startsWith('/signup') &&
    !url.pathname.startsWith('/forgot-password') &&
    !url.pathname.startsWith('/reset-password') &&
    !url.pathname.startsWith('/profile-setup') &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/_next') &&
    !url.pathname.startsWith('/favicon') &&
    !url.pathname.startsWith('/public') &&
    url.pathname !== '/'

  if (isDashboard && !user) {
    const loginUrl = url.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     *  - _next/static  (Next.js static assets)
     *  - _next/image   (Next.js image optimiser)
     *  - favicon.ico   (browser icon)
     *  - api/whatsapp/webhook (Meta sends raw webhooks, no auth cookie)
     *  - public/       (static public files)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/whatsapp/webhook|public/).*)',
  ],
}
