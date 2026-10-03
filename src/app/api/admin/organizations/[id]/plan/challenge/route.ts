import { randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  hashOtpCode,
  isValidPlan,
  OTP_TTL_MS,
  PLAN_VALUES,
} from '@/lib/billing/admin-plan-override';
import { sendAdminOtpCode } from '@/lib/whatsapp/admin-otp-sender';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * POST /api/admin/organizations/[id]/plan/challenge
 *
 * Step 1 of the admin plan-override flow: issues a 6-digit WhatsApp OTP
 * to the ACTING ADMIN's own registered phone (step-up auth — proves
 * live control of that channel, not just a valid session). Never
 * returns the code itself.
 * Body: { plan: 'starter' | 'solo_pro' | 'team' | 'agency' }
 * Protected by super_admin role.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let auth: { userId: string };
  try {
    auth = await requirePlatformAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }
  try {
    const limit = await checkRateLimit(
      `admin:plan-otp:${auth.userId}`,
      RATE_LIMITS.adminOtp
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id: accountId } = await params;
    const body = await request.json().catch(() => null);
    const plan = body?.plan as string | undefined;

    if (!plan || !isValidPlan(plan)) {
      return NextResponse.json(
        { error: `plan must be one of: ${PLAN_VALUES.join(', ')}` },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    const { data: account, error: accountErr } = await admin
      .from('accounts')
      .select('id, name')
      .eq('id', accountId)
      .maybeSingle();

    if (accountErr || !account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const { data: sub } = await admin
      .from('subscriptions')
      .select('plan')
      .eq('account_id', accountId)
      .maybeSingle();
    const currentPlan = (sub as { plan?: string } | null)?.plan ?? 'starter';

    if (currentPlan === plan) {
      return NextResponse.json(
        { error: `Account is already on the ${plan} plan` },
        { status: 400 }
      );
    }

    // The acting admin's OWN phone receives the code — that's the
    // step-up factor. Not the target account's phone.
    const { data: adminProfile } = await admin
      .from('profiles')
      .select('phone')
      .eq('user_id', auth.userId)
      .maybeSingle();
    const adminPhone = (adminProfile as { phone?: string | null } | null)
      ?.phone;

    if (!adminPhone) {
      return NextResponse.json(
        {
          error:
            'Your admin profile has no phone number on file — cannot deliver a WhatsApp OTP.',
        },
        { status: 400 }
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: challenge, error: insertError } = await (admin as any)
      .from('admin_plan_otp_challenges')
      .insert({
        admin_user_id: auth.userId,
        account_id: accountId,
        from_plan: currentPlan,
        to_plan: plan,
        code_hash: hashOtpCode(code),
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (insertError || !challenge) {
      console.error(
        '[admin/organizations/plan/challenge] insert failed:',
        insertError
      );
      return NextResponse.json(
        { error: 'Failed to create verification challenge' },
        { status: 500 }
      );
    }

    const sent = await sendAdminOtpCode(admin, { toPhone: adminPhone, code });
    if (!sent) {
      return NextResponse.json(
        {
          error:
            'Failed to send verification code via WhatsApp. Check the platform WhatsApp sender configuration.',
        },
        { status: 502 }
      );
    }

    console.log(
      `[admin/organizations/plan/challenge] OTP issued for account ${accountId} (${currentPlan} -> ${plan}) by admin ${auth.userId}`
    );

    return NextResponse.json({
      challengeId: (challenge as { id: string }).id,
      expiresAt,
    });
  } catch (error) {
    console.error('[admin/organizations/plan/challenge] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
