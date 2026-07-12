import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { billingAdmin } from '@/lib/billing/admin-client';
import { getPlanLimits } from '@/lib/billing/gates';
import { isUpgrade } from '@/lib/billing/plan-config';
import type { Plan } from '@/lib/billing/types';
import { grantSubscriptionCredits } from '@/lib/credits/grant';
import { processReferralConversion } from '@/lib/credits/referral';
import type { SubscriptionPlanForCredits, BillingCycleForCredits } from '@/lib/credits/types';

function isPaidPlan(plan: string): plan is SubscriptionPlanForCredits {
  return plan === 'solo_pro' || plan === 'team' || plan === 'agency';
}

// POST /api/billing/upgrade
// Switches an active Razorpay subscription to a higher plan immediately.
// Razorpay prorates the charge for the remaining days in the current cycle.
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('owner');

    const body = await request.json().catch(() => null);
    const newPlan = body?.plan as Plan | undefined;
    if (!newPlan) {
      return NextResponse.json({ error: 'plan is required' }, { status: 400 });
    }

    const limits = await getPlanLimits(ctx);
    if (!isUpgrade(limits.plan, newPlan)) {
      return NextResponse.json(
        { error: `${newPlan} is not an upgrade from ${limits.plan}` },
        { status: 400 },
      );
    }

    const { data: sub } = await ctx.supabase
      .from('subscriptions')
      .select('razorpay_subscription_id, razorpay_plan_id, current_period_end')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!sub?.razorpay_subscription_id) {
      return NextResponse.json(
        { error: 'No active subscription found. Use /api/billing/create-subscription to subscribe first.' },
        { status: 404 },
      );
    }

    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const newPlanKey = `RAZORPAY_PLAN_${newPlan.toUpperCase()}_${limits.billing_cycle?.toUpperCase() ?? 'MONTHLY'}`;
    const newRazorpayPlanId = process.env[newPlanKey];
    const hasKeys = !!razorpayKeyId && !!razorpayKeySecret;

    // Sandbox/Development Bypass: if Razorpay configuration is incomplete or plan ID is missing,
    // we bypass the live Razorpay API and automatically activate/upgrade the plan directly
    // in the database. This allows offline/sandbox testing and easy onboarding without live payment keys.
    if (!hasKeys || !newRazorpayPlanId) {
      console.log(`[DEVELOPMENT BYPASS] Razorpay key/plan not configured. Auto-upgrading to ${newPlan} for account ${ctx.accountId}`);
      
      const admin = billingAdmin();
      await admin
        .from('subscriptions')
        .update({ 
          plan: newPlan, 
          razorpay_plan_id: newRazorpayPlanId || 'plan_mock_' + newPlan,
          pending_plan: null, 
          pending_plan_effective_at: null 
        })
        .eq('account_id', ctx.accountId);

      await admin.from('subscription_events').insert({
        account_id: ctx.accountId,
        event_type: 'upgraded',
        from_plan: limits.plan,
        to_plan: newPlan,
        metadata: { immediate: true, mock: true },
      });

      if (isPaidPlan(newPlan)) {
        const cycle = limits.billing_cycle || 'monthly';
        const creditsCycle: BillingCycleForCredits =
          cycle === 'quarterly' ? '3month' : cycle === 'monthly' ? 'monthly' : 'annual';
        await grantSubscriptionCredits(ctx.accountId, newPlan, creditsCycle, {
          isNewCycle: false,
          periodEnd: sub?.current_period_end ?? new Date().toISOString(),
        }).catch((err) => console.error('[billing/upgrade] grantSubscriptionCredits failed:', err));
        await processReferralConversion(ctx.accountId, newPlan).catch((err) =>
          console.error('[billing/upgrade] processReferralConversion failed:', err),
        );
      }

      return NextResponse.json({ success: true, plan: newPlan });
    }

    const credentials = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
    const rzRes = await fetch(
      `https://api.razorpay.com/v1/subscriptions/${sub.razorpay_subscription_id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({ plan_id: newRazorpayPlanId, quantity: 1 }),
      },
    );

    if (!rzRes.ok) {
      const err = await rzRes.json().catch(() => ({}));
      return NextResponse.json({ error: 'Razorpay upgrade failed', details: err }, { status: 502 });
    }

    const admin = billingAdmin();
    await admin
      .from('subscriptions')
      .update({ plan: newPlan, razorpay_plan_id: newRazorpayPlanId, pending_plan: null, pending_plan_effective_at: null })
      .eq('account_id', ctx.accountId);

    await admin.from('subscription_events').insert({
      account_id: ctx.accountId,
      event_type: 'upgraded',
      from_plan: limits.plan,
      to_plan: newPlan,
      metadata: { immediate: true },
    });

    // Immediate upgrade — grant the new plan's monthly credits right
    // away (not a new committed term, so no commitment bonus here;
    // that's reserved for the webhook's subscription.activated/
    // charged path where a fresh cycle is actually being purchased).
    if (isPaidPlan(newPlan)) {
      await grantSubscriptionCredits(ctx.accountId, newPlan, 'monthly', {
        isNewCycle: false,
        periodEnd: sub.current_period_end ?? new Date().toISOString(),
      }).catch((err) => console.error('[billing/upgrade] grantSubscriptionCredits failed:', err));
      await processReferralConversion(ctx.accountId, newPlan).catch((err) =>
        console.error('[billing/upgrade] processReferralConversion failed:', err),
      );
    }

    return NextResponse.json({ success: true, plan: newPlan });
  } catch (err) {
    return toErrorResponse(err);
  }
}
