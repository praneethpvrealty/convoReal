export type SignOutReason = 'expired';

export const SIGN_OUT_REASON_NOTICES: Record<SignOutReason, string> = {
  expired: 'Your session expired — sign in again.',
};

interface AuthErrorLike {
  name?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
}

const STALE_SESSION_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'user_banned',
]);

export function isDefinitiveAuthFailure(error: unknown): boolean {
  if (error === null || error === undefined) return true;
  if (typeof error !== 'object') return false;
  const { name, status, code, message } = error as AuthErrorLike;
  if (name === 'AuthSessionMissingError') return true;
  if (typeof code === 'string' && STALE_SESSION_CODES.has(code)) return true;
  if (
    typeof message === 'string' &&
    /refresh token not found|invalid refresh token/i.test(message)
  ) {
    return true;
  }
  return (
    name === 'AuthApiError' &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}
