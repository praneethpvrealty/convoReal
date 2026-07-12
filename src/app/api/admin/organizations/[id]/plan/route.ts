import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  evaluateChallenge,
  isUpgradeDirection,
  shouldRegrantCredits,
  type OtpChallengeRow,
} from '@/lib/billing/admin-plan-override'
import { grantSubscriptionCredits } from '@/lib/credits/grant'
import type { SubscriptionPlanForCredits } from '@/lib/credits/types'

let _adminClient: ReturnType<typeof createAdminClient> | null = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

async function checkSuperAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { authorized: false, status: 401, error: 'Unauthorized', userId: null }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (profile?.role !== 'super_admin') {
    return { authorized: false, status: 403, error: 'Forbidden', userId: null }
  }

  return { authorized: true, userId: user.id, status: 200, error: null }
}

function isPaidPlan(plan: string): plan is SubscriptionPlanForCredits {
  return plan === 'solo_pro' || plan === 'team' || plan === 'agency'
}

const FAILURE_STATUS: Record<string, number> = {
  not_found: 404,
  used: 410,
  expired: 410,
  too_many_attempts: 429,
  admin_mismatch: 401,
  account_mismatch: 401,
  plan_mismatch: 401,
  wrong_code: 401,
}

/**
 * POST /api/admin/organizations/[id]/plan
 *
 * Step 2 of the admin plan-override flow: verifies the OTP issued by
 * .../plan/challenge and, on success, changes the account's plan
 * immediately — bypassing Razorpay/Stripe entirely (a pure internal
 * entitlement change). Every applied change writes an immutable
 * `subscription_events` row for audit.
 * Body: { challengeId: string, code: string, plan: string }
 * Protected by super_admin role + the OTP step-up above.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const auth = await checkSuperAdmin(supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const limit = checkRateLimit(`admin:plan-otp:${auth.userId}`, RATE_LIMITS.adminOtp)
    if (!limit.success) return rateLimitResponse(limit)

    const { id: accountId } = await params
    const body = await request.json().catch(() => null)
    const { challengeId, code, plan } = (body ?? {}) as {
      challengeId?: string
      code?: string
      plan?: string
    }

    if (!challengeId || !code || !plan) {
      return NextResponse.json(
        { error: 'challengeId, code, and plan are required' },
        { status: 400 }
      )
    }

    const admin = supabaseAdmin()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: challengeRow } = await (admin as any)
      .from('admin_plan_otp_challenges')
      .select('id, admin_user_id, account_id, from_plan, to_plan, code_hash, attempts, expires_at, used_at')
      .eq('id', challengeId)
      .maybeSingle()

    const challenge = challengeRow as OtpChallengeRow | null

    const result = evaluateChallenge(challenge, {
      code,
      nowMs: Date.now(),
      adminUserId: auth.userId!,
      accountId,
      plan,
    })

    if (!result.ok) {
      if (result.incrementAttempts && challenge) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from('admin_plan_otp_challenges')
          .update({ attempts: challenge.attempts + 1 })
          .eq('id', challengeId)
      }
      return NextResponse.json(
        { error: 'Verification failed', reason: result.reason },
        { status: FAILURE_STATUS[result.reason] ?? 401 }
      )
    }

    // challenge is guaranteed non-null here (evaluateChallenge only
    // returns ok:true when the row exists and passed every check).
    const verified = challenge as OtpChallengeRow

    // Mark used immediately (single-use) before mutating billing state,
    // so a retry with the same code can never apply the change twice.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('admin_plan_otp_challenges')
      .update({ used_at: new Date().toISOString() })
      .eq('id', challengeId)

    const fromPlan = verified.from_plan
    const toPlan = verified.to_plan

    const { data: existingSub } = await admin
      .from('subscriptions')
      .select('current_period_end')
      .eq('account_id', accountId)
      .maybeSingle()

    // Upsert — a brand-new account may have no subscriptions row yet
    // (account_plan_limits COALESCEs a missing row to 'starter').
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await (admin as any)
      .from('subscriptions')
      .upsert(
        {
          account_id: accountId,
          plan: toPlan,
          status: 'active',
          pending_plan: null,
          pending_plan_effective_at: null,
        },
        { onConflict: 'account_id' }
      )

    if (upsertError) {
      console.error('[admin/organizations/plan] subscriptions upsert failed:', upsertError)
      return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('subscription_events').insert({
      account_id: accountId,
      event_type: 'admin_override',
      from_plan: fromPlan,
      to_plan: toPlan,
      metadata: {
        actor_user_id: auth.userId,
        direction: isUpgradeDirection(fromPlan, toPlan) ? 'upgrade' : 'downgrade',
        via: 'admin_otp',
      },
    })

    // Upgrade re-grants the target plan's monthly credit allowance
    // immediately, mirroring the self-serve upgrade route. Downgrade
    // deliberately leaves the existing balance untouched — preserved
    // until the next natural cycle (confirmed decision).
    if (shouldRegrantCredits(fromPlan, toPlan) && isPaidPlan(toPlan)) {
      const periodEnd =
        (existingSub as { current_period_end?: string | null } | null)?.current_period_end ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      await grantSubscriptionCredits(accountId, toPlan, 'monthly', {
        isNewCycle: false,
        periodEnd,
      }).catch((err) =>
        console.error('[admin/organizations/plan] grantSubscriptionCredits failed:', err)
      )
    }

    console.log(
      `[admin/organizations/plan] account ${accountId} plan ${fromPlan} -> ${toPlan} by admin ${auth.userId} (OTP verified)`
    )

    return NextResponse.json({ success: true, accountId, plan: toPlan })
  } catch (error) {
    console.error('[admin/organizations/plan] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
