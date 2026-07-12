import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { billingAdmin } from '@/lib/billing/admin-client';
import { PLAN_CONFIG, isUpgrade } from '@/lib/billing/plan-config';
import { getPlanLimits } from '@/lib/billing/gates';
import type { Plan, BillingCycle } from '@/lib/billing/types';
import { grantSubscriptionCredits } from '@/lib/credits/grant';
import { processReferralConversion } from '@/lib/credits/referral';
import type { SubscriptionPlanForCredits, BillingCycleForCredits } from '@/lib/credits/types';

function isPaidPlan(plan: string): plan is SubscriptionPlanForCredits {
  return plan === 'solo_pro' || plan === 'team' || plan === 'agency';
}

// Razorpay plan IDs are created in the Razorpay dashboard and stored
// in env vars. Format: RAZORPAY_PLAN_<PLAN>_<CYCLE>
// e.g. RAZORPAY_PLAN_SOLO_PRO_MONTHLY, RAZORPAY_PLAN_TEAM_ANNUAL
function razorpayPlanId(plan: Plan, cycle: BillingCycle): string | undefined {
  const key = `RAZORPAY_PLAN_${plan.toUpperCase()}_${cycle.toUpperCase()}`;
  return process.env[key];
}

// POST /api/billing/create-subscription
// Creates a Razorpay subscription and returns a checkout URL.
// The client redirects to this URL to complete payment.
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('owner');

    const body = await request.json().catch(() => null);
    if (!body?.plan || !body?.cycle) {
      return NextResponse.json({ error: 'plan and cycle are required' }, { status: 400 });
    }

    const plan = body.plan as Plan;
    const cycle = body.cycle as BillingCycle;

    const validPlans: Plan[] = ['solo_pro', 'team', 'agency'];
    if (!validPlans.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    // Verify this is actually an upgrade from current plan
    const limits = await getPlanLimits(ctx);
    if (!isUpgrade(limits.plan, plan)) {
      return NextResponse.json(
        { error: 'Use /api/billing/upgrade to change between paid plans' },
        { status: 400 },
      );
    }

    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const planId = razorpayPlanId(plan, cycle);
    const hasKeys = !!razorpayKeyId && !!razorpayKeySecret;

    // Sandbox/Development Bypass: if Razorpay configuration is incomplete or plan ID is missing,
    // we bypass the live Razorpay API and automatically activate/upgrade the plan directly
    // in the database. This allows offline/sandbox testing and easy onboarding without live payment keys.
    if (!hasKeys || !planId) {
      console.log(`[DEVELOPMENT BYPASS] Razorpay key/plan not configured. Auto-activating ${plan} (${cycle}) for account ${ctx.accountId}`);
      
      const admin = billingAdmin();
      const periodEnd = new Date();
      if (cycle === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      else if (cycle === 'quarterly') periodEnd.setMonth(periodEnd.getMonth() + 3);
      else periodEnd.setMonth(periodEnd.getMonth() + 1);

      await admin.from('subscriptions').upsert(
        {
          account_id: ctx.accountId,
          plan,
          billing_cycle: cycle,
          status: 'active',
          razorpay_subscription_id: 'sub_mock_' + Math.random().toString(36).substring(2, 11),
          razorpay_plan_id: planId || 'plan_mock_' + plan,
          current_period_end: periodEnd.toISOString(),
        },
        { onConflict: 'account_id' }
      );

      await admin.from('subscription_events').insert({
        account_id: ctx.accountId,
        event_type: 'subscription_created',
        from_plan: limits.plan,
        to_plan: plan,
        metadata: { cycle, plan_display: PLAN_CONFIG[plan].name, mock: true },
      });

      if (isPaidPlan(plan)) {
        const creditsCycle: BillingCycleForCredits =
          cycle === 'quarterly' ? '3month' : cycle === 'monthly' ? 'monthly' : 'annual';
        await grantSubscriptionCredits(ctx.accountId, plan, creditsCycle, {
          isNewCycle: true,
          periodEnd: periodEnd.toISOString(),
        }).catch((err) => console.error('[billing/create-subscription] grantSubscriptionCredits failed:', err));
        await processReferralConversion(ctx.accountId, plan).catch((err) =>
          console.error('[billing/create-subscription] processReferralConversion failed:', err),
        );
      }

      return NextResponse.json({
        subscriptionId: 'mock_sub_' + Math.random().toString(36).substring(2, 11),
        checkoutUrl: '/settings?checkout=success',
      });
    }

    const priceConfig = PLAN_CONFIG[plan];
    const totalCount = cycle === 'annual' ? 10 : cycle === 'quarterly' ? 40 : 120; // Up to 10 years of renewals

    // Create Razorpay subscription via REST API
    const credentials = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
    const razorpayRes = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        plan_id: planId,
        total_count: totalCount,
        quantity: 1,
        notes: {
          account_id: ctx.accountId,
          plan,
          cycle,
        },
      }),
    });

    if (!razorpayRes.ok) {
      const errBody = await razorpayRes.json().catch(() => ({}));
      console.error('[billing/create-subscription] Razorpay error:', errBody);
      return NextResponse.json(
        { error: 'Failed to create Razorpay subscription', details: errBody },
        { status: 502 },
      );
    }

    const rzSub = await razorpayRes.json();

    // Persist a pending subscription row so the webhook knows which account to activate
    const admin = billingAdmin();
    await admin.from('subscriptions').upsert(
      {
        account_id: ctx.accountId,
        plan,
        billing_cycle: cycle,
        status: 'trialing',
        razorpay_subscription_id: rzSub.id,
        razorpay_plan_id: planId,
      },
      { onConflict: 'account_id' },
    );

    // Log the event
    await admin.from('subscription_events').insert({
      account_id: ctx.accountId,
      event_type: 'subscription_created',
      from_plan: limits.plan,
      to_plan: plan,
      razorpay_event_id: rzSub.id,
      metadata: { cycle, plan_display: priceConfig.name },
    });

    // Return the short_url so the client can redirect to Razorpay checkout
    return NextResponse.json({
      subscriptionId: rzSub.id,
      checkoutUrl: rzSub.short_url,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
