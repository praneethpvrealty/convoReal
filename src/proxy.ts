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
  const timeoutPromise = new Promise<{ data: { user: null }; error: Error }>((_, reject) =>
    setTimeout(() => reject(new Error('Supabase request timed out')), 4000)
  )

  let data = null
  let error: Error | null = null
  try {
    const res = await Promise.race([getUserPromise, timeoutPromise])
    data = res.data
    error = res.error
  } catch (err) {
    console.error('[proxy] getUser failed or timed out:', err)
    error = err instanceof Error ? err : new Error(String(err))
  }

  const user = data?.user ?? null

  if (
    error &&
    ((error as { code?: string }).code === 'refresh_token_not_found' ||
      error.message?.includes('Refresh Token Not Found') ||
      error.message?.includes('Invalid Refresh Token'))
  ) {
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

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
