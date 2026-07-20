import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const SUPABASE_COOKIE_PREFIXES = [
  'sb-access-token',
  'sb-refresh-token',
  'sb-auth-token',
]

function clearAuthCookies(res: NextResponse, req: NextRequest) {
  const all = req.cookies.getAll()
  for (const { name } of all) {
    if (
      SUPABASE_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
      name.includes('-auth-token')
    ) {
      res.cookies.set(name, '', { maxAge: 0, path: '/' })
    }
  }
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

  // Race getUser against a 4-second timeout to prevent Supabase outages from freezing page load
  const getUserPromise = supabase.auth.getUser()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<{ data: { user: null }; error: Error }>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Supabase request timed out')), 4000)
  })

  // A thrown/timed-out getUser means auth is UNAVAILABLE, not that the
  // caller is signed out. Those are handled differently below: definitive
  // "no user" answers gate as usual, while infrastructure failures fail
  // open — every API route re-checks auth itself and RLS scopes all data,
  // so failing open never exposes anything; failing closed would kick
  // validly-signed-in users to /login on every Supabase latency blip.
  let data = null
  let error: Error | null = null
  let authUnavailable = false
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

  const user = data?.user ?? null

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

  if (
    error &&
    ((error as { code?: string }).code === 'refresh_token_not_found' ||
      error.message?.includes('Refresh Token Not Found') ||
      error.message?.includes('Invalid Refresh Token'))
  ) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      console.warn('[proxy] stale refresh token detected on API route — returning 401 without clearing cookies')
      return NextResponse.json(
        { error: 'Unauthorized', code: 'stale_session' },
        { status: 401 }
      )
    }

    console.warn('[proxy] stale refresh token detected — clearing cookies and redirecting to /login')
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    const redirectResponse = NextResponse.redirect(loginUrl)
    clearAuthCookies(redirectResponse, request)
    return redirectResponse
  }


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
    return NextResponse.redirect(url)
  }

  // Protected pages - redirect to login if not authenticated. Skipped
  // when auth was unavailable (timeout/network): the dashboard shell
  // client-side redirects genuinely signed-out users, so a Supabase
  // blip doesn't bounce a valid session to /login.
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/verify-phone']
  if (!user && !authUnavailable && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
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
    return NextResponse.redirect(url)
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
