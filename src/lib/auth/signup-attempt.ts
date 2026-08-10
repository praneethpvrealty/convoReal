export const SIGNUP_STAGES = ['landed', 'submitted', 'failed', 'succeeded'] as const;
export const SIGNUP_GATES = ['no_invite', 'beta', 'team_invite', 'bypass'] as const;

export type SignupStage = (typeof SIGNUP_STAGES)[number];
export type SignupGate = (typeof SIGNUP_GATES)[number];

export interface GateInput {
  betaToken: string | null;
  inviteToken: string | null;
  bypassGate: boolean;
}

/**
 * Which door a visitor came through, matching what /signup renders:
 * only `no_invite` sees the waitlist card instead of a form. A token
 * wins over the bypass, so someone who taps the escape hatch and then
 * arrives with a real invite is not filed as a bypass.
 */
export function signupGate({ betaToken, inviteToken, bypassGate }: GateInput): SignupGate {
  if (betaToken) return 'beta';
  if (inviteToken) return 'team_invite';
  if (bypassGate) return 'bypass';
  return 'no_invite';
}

const SESSION_STORAGE_KEY = 'convoreal.signup.session';

/** One key per tab, so the stages of a single visit line up. */
export function signupSessionKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const key = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, key);
    return key;
  } catch {
    // Private mode, or storage disabled. An uncorrelated key still
    // counts the visit; losing the funnel link beats losing the row.
    return crypto.randomUUID();
  }
}

/**
 * Fire-and-forget. Never awaited by the signup flow and never throws —
 * an analytics write must not be able to stop someone opening an
 * account.
 */
export function recordSignupAttempt(input: {
  stage: SignupStage;
  gate: SignupGate;
  email?: string;
  errorMessage?: string;
}): void {
  const sessionKey = signupSessionKey();
  if (!sessionKey) return;

  void fetch('/api/public/signup-attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_key: sessionKey,
      stage: input.stage,
      gate: input.gate,
      email: input.email,
      error_message: input.errorMessage,
    }),
    keepalive: true,
  }).catch(() => {});
}
