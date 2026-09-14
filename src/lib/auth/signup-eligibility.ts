/**
 * Why a signup was refused, in words the person can act on.
 *
 * handle_new_user() raises a specific, deliberately friendly message
 * for each way the invite gate can say no — expired, claimed, revoked,
 * seats gone. None of it reaches the browser: GoTrue flattens any
 * trigger exception into "Database error creating new user", so an
 * invited user whose link had expired was told the database was
 * broken.
 *
 * The reasons are re-derived here, from the same tables the trigger
 * reads, and mapped to the message the trigger meant to send.
 */
export const SIGNUP_REFUSAL_REASONS = [
  'no_invite',
  'invalid_token',
  'revoked',
  'claimed',
  'expired',
  'seats_full',
  'eligible',
  'unknown',
] as const;

export type SignupRefusalReason = (typeof SIGNUP_REFUSAL_REASONS)[number];

const MESSAGES: Record<SignupRefusalReason, string> = {
  no_invite:
    'ConvoReal is invite-only right now. You need an invitation link to create an account.',
  invalid_token:
    'That invitation link is not valid. Ask whoever invited you for a fresh one.',
  revoked:
    'That invitation was withdrawn. Ask whoever invited you for a fresh one.',
  claimed: 'That invitation has already been claimed.',
  expired:
    'That invitation has expired. Ask whoever invited you for a fresh one.',
  seats_full: 'All the beta seats have been claimed.',
  // The gate said yes, so the refusal came from somewhere else. Say
  // that plainly rather than blaming the invite.
  eligible: 'Something went wrong creating your account. Please try again.',
  unknown: 'Something went wrong creating your account. Please try again.',
};

export function signupRefusalMessage(reason: SignupRefusalReason): string {
  return MESSAGES[reason];
}

/** The opaque string GoTrue returns for any exception raised by a
 *  trigger on auth.users. */
export function isOpaqueSignupError(message: string): boolean {
  return /database error (creating|saving) new user/i.test(message.trim());
}

/**
 * Ask the server why the gate refused. Never throws and never leaves
 * the caller without a message: a failed lookup is 'unknown', which
 * reads as a generic retry rather than a wrong accusation about the
 * invite.
 */
export async function fetchSignupRefusalReason(input: {
  betaToken: string | null;
  teamToken: string | null;
}): Promise<SignupRefusalReason> {
  try {
    const response = await fetch('/api/public/signup-eligibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        betaToken: input.betaToken ?? undefined,
        teamToken: input.teamToken ?? undefined,
      }),
    });
    if (!response.ok) return 'unknown';
    const body = (await response.json()) as {
      data?: { reason?: SignupRefusalReason };
    };
    const reason = body.data?.reason;
    return reason && SIGNUP_REFUSAL_REASONS.includes(reason)
      ? reason
      : 'unknown';
  } catch {
    return 'unknown';
  }
}
