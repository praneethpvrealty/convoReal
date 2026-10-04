import type { supabaseAdmin } from '@/lib/supabase/admin';
import type { SignupRefusalReason } from '@/lib/auth/signup-eligibility';

type AdminClient = ReturnType<typeof supabaseAdmin>;

export interface StaffBootstrapGate {
  allowed: boolean;
  reason: SignupRefusalReason;
  betaInvite: { id: string; quota: number; seat: number } | null;
}

function token(
  metadata: Record<string, unknown> | null | undefined,
  key: string
) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function resolveStaffBootstrapGate(
  db: AdminClient,
  user: { user_metadata?: Record<string, unknown> | null }
): Promise<StaffBootstrapGate> {
  const { data: program } = await db
    .from('beta_program')
    .select('gate_enabled, account_cap, default_quota')
    .maybeSingle();
  if (!program || !program.gate_enabled) {
    return { allowed: true, reason: 'eligible', betaInvite: null };
  }

  const teamToken = token(user.user_metadata, 'team_invite');
  if (teamToken) {
    const { data: hash } = await db.rpc('hash_beta_token', {
      p_token: teamToken,
    });
    const { data: invitation } = await db
      .from('account_invitations')
      .select('accepted_at, expires_at')
      .eq('token_hash', hash ?? '')
      .maybeSingle();
    if (
      invitation &&
      !invitation.accepted_at &&
      new Date(invitation.expires_at) > new Date()
    ) {
      return { allowed: true, reason: 'eligible', betaInvite: null };
    }
  }

  const betaToken = token(user.user_metadata, 'beta_invite');
  if (!betaToken)
    return { allowed: false, reason: 'no_invite', betaInvite: null };

  const { data: hash } = await db.rpc('hash_beta_token', {
    p_token: betaToken,
  });
  const { data: invite } = await db
    .from('beta_invites')
    .select('id, status, expires_at')
    .eq('token_hash', hash ?? '')
    .maybeSingle();
  if (!invite)
    return { allowed: false, reason: 'invalid_token', betaInvite: null };
  if (invite.status === 'revoked')
    return { allowed: false, reason: 'revoked', betaInvite: null };
  if (invite.status === 'accepted')
    return { allowed: false, reason: 'claimed', betaInvite: null };
  if (new Date(invite.expires_at) <= new Date())
    return { allowed: false, reason: 'expired', betaInvite: null };

  const { data: taken } = await db.rpc('beta_seats_taken');
  const seatsTaken = typeof taken === 'number' ? taken : 0;
  if (seatsTaken >= program.account_cap)
    return { allowed: false, reason: 'seats_full', betaInvite: null };

  return {
    allowed: true,
    reason: 'eligible',
    betaInvite: {
      id: invite.id,
      quota: program.default_quota,
      seat: seatsTaken + 1,
    },
  };
}
