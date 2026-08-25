// ============================================================
// POST   /api/beta-invites/[id] — rotate and resend an unclaimed seat.
// DELETE /api/beta-invites/[id] — revoke an unclaimed seat.
//
// Admin+. Frees the seat back into the account's quota.
//
// Ownership and the "not already claimed" rule are enforced inside
// revoke_beta_invite() (migration 188) under a row lock, not here —
// checking in the route would race a concurrent redemption.
// ============================================================

import { NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { inviteBaseUrl } from '@/lib/auth/invite-base-url';
import {
  betaInviteShareMessage,
  betaInviteUrl,
  generateBetaInvite,
} from '@/lib/beta/invites';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

interface BetaProgram {
  account_cap: number;
  seats_taken: number;
}

function rpcErrorToResponse(
  err: PostgrestError,
  action: 'resend' | 'revoke'
): NextResponse {
  if (err.code === '42501') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  if (err.code === '22023') {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error(
    `[${action.toUpperCase()} /api/beta-invites/[id]] unexpected RPC error:`,
    err
  );
  return NextResponse.json(
    { error: `Failed to ${action} invitation` },
    { status: 500 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = await checkRateLimit(
      `beta:resend:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: 'Missing invitation id' },
        { status: 400 }
      );
    }

    const { token, hash, code } = generateBetaInvite();
    const { data, error } = await ctx.supabase.rpc('rotate_beta_invite', {
      p_id: id,
      p_token_hash: hash,
      p_code: code,
    });
    if (error) return rpcErrorToResponse(error, 'resend');

    const rotated = data as {
      id: string;
      code: string;
      label: string | null;
      invitee_phone: string | null;
      expires_at: string;
    };
    const url = betaInviteUrl(
      token,
      inviteBaseUrl(request, 'POST /api/beta-invites/[id]')
    );
    const [{ data: program }, { data: profile }] = await Promise.all([
      ctx.supabase.rpc('beta_program_public'),
      ctx.supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', ctx.userId)
        .maybeSingle(),
    ]);
    const prog = program as BetaProgram | null;
    const expiryDays = Math.max(
      1,
      Math.round(
        (new Date(rotated.expires_at).getTime() - Date.now()) / 86_400_000
      )
    );

    return NextResponse.json({
      id: rotated.id,
      code: rotated.code,
      url,
      inviteePhone: rotated.invitee_phone,
      shareMessage: betaInviteShareMessage({
        url,
        inviterName: profile?.full_name || null,
        inviteeName: rotated.label,
        seatsRemaining: prog
          ? Math.max(0, prog.account_cap - prog.seats_taken)
          : null,
        expiryDays,
      }),
      expiresAt: rotated.expires_at,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = await checkRateLimit(
      `beta:revoke:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: 'Missing invitation id' },
        { status: 400 }
      );
    }

    const { error } = await ctx.supabase.rpc('revoke_beta_invite', {
      p_id: id,
    });
    if (error) return rpcErrorToResponse(error, 'revoke');

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
