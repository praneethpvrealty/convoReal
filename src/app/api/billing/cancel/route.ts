import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { billingAdmin } from '@/lib/billing/admin-client';
import { getPlanLimits } from '@/lib/billing/gates';

// POST /api/billing/cancel
// Cancels the subscription at end of current billing cycle.
// Account reverts to Starter when the period ends.
export async function POST() {
  try {
    const ctx = await requireRole('owner');

    const limits = await getPlanLimits(ctx);
    if (limits.plan === 'starter') {
      return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 });
    }

    const { data: sub } = await ctx.supabase
      .from('subscriptions')
      .select('razorpay_subscription_id, current_period_end')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!sub) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
    }

    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

    if (razorpayKeyId && razorpayKeySecret && sub.razorpay_subscription_id) {
      const credentials = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
      await fetch(
        `https://api.razorpay.com/v1/subscriptions/${sub.razorpay_subscription_id}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${credentials}`,
          },
          body: JSON.stringify({ cancel_at_cycle_end: 1 }),
        },
      );
    }

    const admin = billingAdmin();
    await admin
      .from('subscriptions')
      .update({ status: 'canceled', canceled_at: new Date().toISOString() })
      .eq('account_id', ctx.accountId);

    await admin.from('subscription_events').insert({
      account_id: ctx.accountId,
      event_type: 'canceled',
      from_plan: limits.plan,
      to_plan: 'starter',
      metadata: { effective_at: sub.current_period_end },
    });

    return NextResponse.json({
      success: true,
      message: `Subscription canceled. You retain access until ${new Date(sub.current_period_end ?? Date.now()).toLocaleDateString('en-IN')}.`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
