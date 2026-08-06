import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  hashRevokePayload,
  parseRevokeRequest,
} from '@/lib/billing/admin-extension';
import {
  consumeExtensionChallenge,
  requireSuperAdmin,
} from '@/lib/billing/admin-extension-server';

/**
 * POST /api/admin/subscription-extensions/revoke
 *
 * Withdraws service credit that was granted in error — by extension id,
 * or incident-wide via incidentRef so a mistaken bulk grant can be
 * undone in one action.
 *
 * Rows are never deleted: `revoked_at` is stamped instead, which drops
 * them out of the account_plan_limits calculation while leaving the
 * grant and its withdrawal both visible in the audit trail. Already
 * revoked rows are skipped, so a repeated call is a no-op rather than
 * an overwrite of the original revocation.
 *
 * Carries the same OTP step-up as granting: this takes paid days away
 * from a customer, so it should be no easier than giving them.
 *
 * Body: { challengeId, code, extensionIds? | incidentRef?, reason? }
 * Protected by super_admin role + WhatsApp OTP step-up.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = supabaseAdmin();
    const auth = await requireSuperAdmin(supabase, admin);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limit = checkRateLimit(
      `admin:extension-otp:${auth.userId}`,
      RATE_LIMITS.adminOtp
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const { challengeId, code } = (body ?? {}) as {
      challengeId?: string;
      code?: string;
    };

    if (!challengeId || !code) {
      return NextResponse.json(
        { error: 'challengeId and code are required' },
        { status: 400 }
      );
    }

    const parsed = parseRevokeRequest(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const req = parsed.value;

    const consumed = await consumeExtensionChallenge({
      admin,
      challengeId,
      code,
      adminUserId: auth.userId,
      action: 'extension_revoke',
      payloadHash: hashRevokePayload(req),
    });

    if (!consumed.ok) {
      return NextResponse.json(
        { error: 'Verification failed', reason: consumed.reason },
        { status: consumed.status }
      );
    }

    const revokedAt = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update = (admin as any)
      .from('subscription_extensions')
      .update({
        revoked_at: revokedAt,
        revoked_by: auth.userId,
        revoke_reason: req.reason,
      })
      .is('revoked_at', null);

    const { data: revoked, error: updateError } = req.incidentRef
      ? await update
          .eq('incident_ref', req.incidentRef)
          .select('id, account_id, days')
      : await update.in('id', req.extensionIds).select('id, account_id, days');

    if (updateError) {
      console.error(
        '[admin/subscription-extensions/revoke] update failed:',
        updateError
      );
      return NextResponse.json(
        { error: 'Failed to revoke extensions' },
        { status: 500 }
      );
    }

    const rows = (revoked ?? []) as {
      id: string;
      account_id: string;
      days: number;
    }[];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('subscription_events').insert(
      rows.map((row) => ({
        account_id: row.account_id,
        event_type: 'admin_extension_revoked',
        metadata: {
          actor_user_id: auth.userId,
          actor_email: auth.email,
          extension_id: row.id,
          days: row.days,
          incident_ref: req.incidentRef,
          reason: req.reason,
          via: 'admin_otp',
        },
      }))
    );

    console.log(
      `[admin/subscription-extensions/revoke] revoked ${rows.length} extension(s), incident=${req.incidentRef ?? '-'} by admin ${auth.userId} (OTP verified)`
    );

    return NextResponse.json({ success: true, revoked: rows.length });
  } catch (error) {
    console.error('[admin/subscription-extensions/revoke] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
