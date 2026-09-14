import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import type { SignupRefusalReason } from '@/lib/auth/signup-eligibility';

// POST /api/public/signup-eligibility
// Why the invite gate would refuse this token, so /signup can say it.
//
// Public and unauthenticated by necessity: it answers for someone who
// has no account yet. It is called only after signUp() has already
// failed, and tells the caller nothing that attempt did not — the
// trigger refuses on exactly these grounds. Tokens are looked up by
// hash and never echoed back.

const IP_LIMIT = { limit: 10, windowMs: 60_000 };
const GLOBAL_LIMIT = { limit: 120, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const perIp = await checkRateLimit(`signupeligibility:ip:${ip}`, IP_LIMIT);
  if (!perIp.success) return rateLimitResponse(perIp);
  const global = await checkRateLimit('signupeligibility:global', GLOBAL_LIMIT);
  if (!global.success) return rateLimitResponse(global);

  const body = (await request.json().catch(() => null)) as {
    betaToken?: string;
    teamToken?: string;
  } | null;

  const betaToken = (body?.betaToken || '').trim().slice(0, 256);
  const teamToken = (body?.teamToken || '').trim().slice(0, 256);

  try {
    const db = supabaseAdmin();

    // A live team invite authorises the signup on its own, exactly as
    // in handle_new_user().
    if (teamToken) {
      const { data: hash } = await db.rpc('hash_beta_token', {
        p_token: teamToken,
      });
      const { data: invitation } = await db
        .from('account_invitations')
        .select('accepted_at, expires_at')
        .eq('token_hash', hash)
        .maybeSingle();
      if (!invitation) return reason('invalid_token');
      if (invitation.accepted_at) return reason('claimed');
      if (new Date(invitation.expires_at) <= new Date())
        return reason('expired');
      return reason('eligible');
    }

    if (!betaToken) return reason('no_invite');

    const { data: hash } = await db.rpc('hash_beta_token', {
      p_token: betaToken,
    });
    const { data: invite } = await db
      .from('beta_invites')
      .select('status, expires_at')
      .eq('token_hash', hash)
      .maybeSingle();

    if (!invite) return reason('invalid_token');
    if (invite.status === 'revoked') return reason('revoked');
    if (invite.status === 'accepted') return reason('claimed');
    if (new Date(invite.expires_at) <= new Date()) return reason('expired');

    const { data: program } = await db
      .from('beta_program')
      .select('account_cap')
      .maybeSingle();
    const { data: taken } = await db.rpc('beta_seats_taken');
    if (program && typeof taken === 'number' && taken >= program.account_cap)
      return reason('seats_full');

    return reason('eligible');
  } catch (err) {
    console.error('[POST /api/public/signup-eligibility] Failed:', err);
    return reason('unknown');
  }
}

function reason(value: SignupRefusalReason) {
  return NextResponse.json({ data: { reason: value } });
}
