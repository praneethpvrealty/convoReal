interface ClaimsResult {
  data: { claims?: { sub?: unknown } | null } | null;
  error: unknown;
}

interface UserResult {
  data: { user: { id: string } | null } | null;
  error: unknown;
}

export interface VerifiedUserAuth {
  getClaims?: () => Promise<ClaimsResult>;
  getUser: () => Promise<UserResult>;
}

export interface VerifiedUser {
  userId: string | null;
  error: (Error & { code?: string }) | null;
}

/**
 * Resolve the caller from their access token without a GoTrue round trip.
 *
 * `getClaims()` checks the token's signature and expiry against the
 * project's public signing keys, which supabase-js caches in memory, so
 * a warm instance answers locally. `getUser()` asks GoTrue on every
 * call. The local answer cannot see a session revoked since the token
 * was issued; that token stays valid until it expires, and the profile
 * and account checks that follow still run against the database on
 * every request. Only when local verification cannot run at all (the
 * signing keys could not be fetched) does this ask GoTrue instead.
 * supabase-js reports that as a returned error, not a thrown one, so
 * the error is read: a network failure, a 5xx or an unknown error is
 * the service being unavailable, anything else is the token's verdict.
 */
function isUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, status } = error as { name?: unknown; status?: unknown };
  return (
    name === 'AuthRetryableFetchError' ||
    name === 'AuthUnknownError' ||
    (typeof status === 'number' && (status === 0 || status >= 500))
  );
}

export async function resolveVerifiedUser(
  auth: VerifiedUserAuth
): Promise<VerifiedUser> {
  let claims: ClaimsResult | null = null;
  try {
    if (auth.getClaims) claims = await auth.getClaims();
  } catch {
    claims = null;
  }
  if (claims && !isUnavailable(claims.error)) {
    if (claims.error) {
      return { userId: null, error: claims.error as VerifiedUser['error'] };
    }
    const sub = claims.data?.claims?.sub;
    return {
      userId: typeof sub === 'string' && sub.length > 0 ? sub : null,
      error: null,
    };
  }
  const { data, error } = await auth.getUser();
  return {
    userId: error ? null : (data?.user?.id ?? null),
    error: (error as VerifiedUser['error']) ?? null,
  };
}
