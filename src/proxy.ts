import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const SUPABASE_COOKIE_PREFIXES = [
  'sb-access-token',
  'sb-refresh-token',
  'sb-auth-token',
]

function isAuthCookie(name: string) {
  return (
    SUPABASE_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
    name.includes('-auth-token')
  )
}

function clearAuthCookies(res: NextResponse, req: NextRequest) {
  const all = req.cookies.getAll()
  for (const { name } of all) {
    if (isAuthCookie(name)) {
      res.cookies.set(name, '', { maxAge: 0, path: '/' })
    }
  }
}

// A refresh token GoTrue no longer knows about — revoked, rotated past
// the reuse window, or a truncated cookie chunk. The session is
// unrecoverable, so the caller is signed out, not "auth is down".
function isStaleRefreshToken(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return (
    error.code === 'refresh_token_not_found' ||
    error.message?.includes('Refresh Token Not Found') === true ||
    error.message?.includes('Invalid Refresh Token') === true
  )
}

export async function proxy(request: NextRequest) {
  // Create the response upfront so cookie mutations always target the same object.
  // Do NOT create a new NextResponse inside setAll — that drops cookies and causes
  // the auth session to appear missing on the next request, creating a refresh loop.
  const supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write updated cookies onto both the request (for upstream reads)
          // and the stable supabaseResponse (so the browser receives them).
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // A thrown/timed-out getUser means auth is UNAVAILABLE, not that the
  // caller is signed out. Those are handled differently below: definitive
  // "no user" answers gate as usual, while infrastructure failures fail
  // open — every API route re-checks auth itself and RLS scopes all data,
  // so failing open never exposes anything; failing closed would kick
  // validly-signed-in users to /login on every Supabase latency blip.
  let data: { user: { id: string } | null } | null = null
  let error: (Error & { code?: string }) | null = null
  let authUnavailable = false

  // No auth cookie means there is no cookie session to resolve — the
  // answer is "signed out" without a GoTrue round-trip. Skipping it
  // keeps every public page, webhook, and cookieless bearer request off
  // the auth network path entirely.
  const hasAuthCookie = request.cookies.getAll().some(({ name }) => isAuthCookie(name))

  if (hasAuthCookie) {
    // Race getUser against a 4-second timeout to prevent Supabase outages from freezing page load
    const getUserPromise = supabase.auth.getUser()
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<{ data: { user: null }; error: Error }>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Supabase request timed out')), 4000)
    })

    try {
      const res = await Promise.race([getUserPromise, timeoutPromise])
      data = res.data
      error = res.error
    } catch (err) {
      console.error('[proxy] getUser failed or timed out:', err)
      error = err instanceof Error ? err : new Error(String(err))
      authUnavailable = true
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  const user = data?.user ?? null

  // A dead refresh token is a definitive "signed out", so the request
  // continues through the normal gates below — public pages and public
  // /api routes still serve, protected ones redirect to /login. What it
  // must NOT do is short-circuit: returning early here discarded the
  // cookie deletions @supabase/ssr had already staged on
  // supabaseResponse, so the browser kept replaying the dead token and
  // every request re-ran the same doomed refresh.
  const staleSession = isStaleRefreshToken(error)
  if (staleSession) {
    console.warn('[proxy] stale refresh token — clearing auth cookies and continuing as signed out')
  }

  // Apply the cookie clearing to whichever response actually goes back,
  // including the redirects below (each is a fresh NextResponse that
  // does not inherit supabaseResponse's headers).
  const finalize = (res: NextResponse) => {
    if (staleSession) clearAuthCookies(res, request)
    return res
  }

  // The mobile app authenticates with `Authorization: Bearer <jwt>` and
  // sends no cookies, so the cookie-based getUser() above always resolves
  // to no user for it. The `/api/whatsapp/*` gate below is an early-exit
  // optimisation, not the boundary — every route re-validates auth via
  // createClient() + getUser(), which DOES read the bearer token — so a
  // bearer-carrying request must be allowed through to its handler rather
  // than 401'd here. Without this, every authenticated mobile call to
  // /api/whatsapp/* (send, react, media, broadcast) fails "Unauthorized"
  // before the route runs, while cookie-based web sessions work.
  const hasBearerJwt = /^Bearer\s+[\w-]+\.[\w-]+\.[\w-]+$/i.test(
    request.headers.get('authorization') ?? ''
  )

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return finalize(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated. Skipped
  // when auth was unavailable (timeout/network): the dashboard shell
  // client-side redirects genuinely signed-out users, so a Supabase
  // blip doesn't bounce a valid session to /login.
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/verify-phone']
  if (!user && !authUnavailable && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return finalize(NextResponse.redirect(url))
  }

  // Owners Den pages — the owner-facing portal has its own login at
  // /den/login (WhatsApp OTP / Google). Same fail-open semantics as
  // above: every /api/den route re-checks via getDenContext(), and the
  // Den layout redirects unverified sessions client-side.
  const denPublicPaths = ['/den/login']
  if (
    !user &&
    !authUnavailable &&
    request.nextUrl.pathname.startsWith('/den') &&
    !denPublicPaths.some(path => request.nextUrl.pathname.startsWith(path))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/den/login'
    url.search = ''
    return finalize(NextResponse.redirect(url))
  }

  // Buyer portal pages — same pattern as the Den: own login at
  // /buyer/login, every /api/buyer route re-checks via
  // getBuyerContext(), and the portal layout redirects unverified
  // sessions client-side.
  const buyerPublicPaths = ['/buyer/login']
  if (
    !user &&
    !authUnavailable &&
    request.nextUrl.pathname.startsWith('/buyer') &&
    !buyerPublicPaths.some(path => request.nextUrl.pathname.startsWith(path))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/buyer/login'
    url.search = ''
    return finalize(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks, and not Meta's Flows
  // data-exchange endpoint — /api/whatsapp/flows/endpoint/[accountId]
  // is called directly by Meta with no browser session at all, for
  // health-check pings as well as real INIT/data_exchange traffic once
  // published. It authenticates itself via HMAC signature + RSA/AES
  // encryption (see webhook-signature.ts / flow-crypto.ts) — gating it
  // here made Meta's health check (and the flow itself) permanently
  // fail with 401 before the route handler ever ran).
  // Also fails open when auth was unavailable — every route handler
  // calls getUser()/requireRole itself, so this gate is an early-exit
  // optimisation, not the boundary.
  if (!user && !authUnavailable && !hasBearerJwt && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook') &&
      !request.nextUrl.pathname.startsWith('/api/whatsapp/flows/endpoint/')) {
    return finalize(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  }

  return finalize(supabaseResponse)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
