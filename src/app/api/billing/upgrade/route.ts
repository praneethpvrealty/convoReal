import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { billingAdmin } from '@/lib/billing/admin-client';
import { getPlanLimits } from '@/lib/billing/gates';
import { isUpgrade } from '@/lib/billing/plan-config';
import type { Plan } from '@/lib/billing/types';

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
      .select('razorpay_subscription_id, razorpay_plan_id')
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
    if (!razorpayKeyId || !razorpayKeySecret) {
      return NextResponse.json({ error: 'Razorpay is not configured' }, { status: 503 });
    }

    const newPlanKey = `RAZORPAY_PLAN_${newPlan.toUpperCase()}_${limits.billing_cycle?.toUpperCase() ?? 'MONTHLY'}`;
    const newRazorpayPlanId = process.env[newPlanKey];
    if (!newRazorpayPlanId) {
      return NextResponse.json(
        { error: `Razorpay plan ID not configured for ${newPlan}. Add ${newPlanKey} to your environment.` },
        { status: 503 },
      );
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

    return NextResponse.json({ success: true, plan: newPlan });
  } catch (err) {
    return toErrorResponse(err);
  }
}
