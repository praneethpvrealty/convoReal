import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'

/**
 * Server-side Supabase client for API routes and server components.
 *
 * Two auth transports, resolved per request:
 *
 * 1. `Authorization: Bearer <access_token>` header — used by the mobile
 *    app (see docs/mobile-app-implementation-plan.md), which has no
 *    cookies. The JWT is attached to every PostgREST/Storage request, so
 *    RLS is enforced exactly as for a cookie session, and
 *    `auth.getUser()` validates that JWT against GoTrue.
 * 2. Supabase session cookies (web SSR) — unchanged fallback when no
 *    bearer header is present.
 *
 * Keeping the branch here — the one chokepoint every route's client
 * comes from — means `getCurrentAccount()` / `requireRole()` and routes
 * that call `auth.getUser()` directly all accept mobile tokens with no
 * per-route changes.
 */
export async function createClient() {
  const bearerToken = getBearerToken(
    (await headers()).get('authorization')
  )

  if (bearerToken) {
    const client = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        // No cookie session on this path — the JWT is the session.
        cookies: {
          getAll() {
            return []
          },
          setAll() {},
        },
        global: {
          headers: { Authorization: `Bearer ${bearerToken}` },
        },
      }
    )

    // GoTrue's no-arg `getUser()` resolves the token from the (absent)
    // cookie session and would fail with AuthSessionMissingError, but
    // `getUser(jwt)` validates the given JWT server-side. Existing
    // callers all use the no-arg form, so default it to the bearer JWT.
    const originalGetUser = client.auth.getUser.bind(client.auth)
    client.auth.getUser = ((jwt?: string) =>
      originalGetUser(jwt ?? bearerToken)) as typeof client.auth.getUser

    return client
  }

  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}

/**
 * Extract a Supabase access token from an `Authorization` header value.
 *
 * Deliberately strict: only `Bearer <three-part JWT>` counts. Vercel
 * Cron requests carry `Bearer ${CRON_SECRET}` (an opaque string, not a
 * JWT) — the shape check keeps those requests on the cookie path
 * instead of sending a non-JWT to PostgREST.
 */
function getBearerToken(headerValue: string | null): string | null {
  const token = headerValue?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return null
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : null
}
