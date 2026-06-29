import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { billingAdmin } from '@/lib/billing/admin-client';
import { PLAN_CONFIG, isUpgrade } from '@/lib/billing/plan-config';
import { getPlanLimits } from '@/lib/billing/gates';
import type { Plan, BillingCycle } from '@/lib/billing/types';

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
    if (!razorpayKeyId || !razorpayKeySecret) {
      return NextResponse.json(
        { error: 'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to your environment.' },
        { status: 503 },
      );
    }

    const planId = razorpayPlanId(plan, cycle);
    if (!planId) {
      return NextResponse.json(
        { error: `Razorpay plan ID not configured for ${plan}/${cycle}. Add ${`RAZORPAY_PLAN_${plan.toUpperCase()}_${cycle.toUpperCase()}`} to your environment.` },
        { status: 503 },
      );
    }

    const priceConfig = PLAN_CONFIG[plan];
    const totalCount = cycle === 'annual' ? 1 : 120; // 120 months max (10 years)

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
