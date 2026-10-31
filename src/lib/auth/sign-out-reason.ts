export type SignOutReason = 'expired';

export const SIGN_OUT_REASON_PARAM = 'reason';

export const SIGN_OUT_REASON_STORAGE_KEY = 'convoreal:sign-out-reason';

export const SIGN_OUT_REASON_NOTICES: Record<SignOutReason, string> = {
  expired: 'Your session expired — sign in again.',
};

export function parseSignOutReason(value: unknown): SignOutReason | null {
  return value === 'expired' ? 'expired' : null;
}
