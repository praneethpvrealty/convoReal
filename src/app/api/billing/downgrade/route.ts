import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { billingAdmin } from '@/lib/billing/admin-client';
import { getPlanLimits } from '@/lib/billing/gates';
import { isDowngrade } from '@/lib/billing/plan-config';
import type { Plan } from '@/lib/billing/types';

// POST /api/billing/downgrade
// Schedules a plan reduction for the end of the current billing cycle.
// The user keeps current features until period_end.
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('owner');

    const body = await request.json().catch(() => null);
    const newPlan = body?.plan as Plan | undefined;
    if (!newPlan) {
      return NextResponse.json({ error: 'plan is required' }, { status: 400 });
    }

    const limits = await getPlanLimits(ctx);
    if (!isDowngrade(limits.plan, newPlan)) {
      return NextResponse.json(
        { error: `${newPlan} is not a downgrade from ${limits.plan}` },
        { status: 400 },
      );
    }

    const { data: sub } = await ctx.supabase
      .from('subscriptions')
      .select('razorpay_subscription_id, current_period_end')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!sub) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
    }

    const effectiveAt = sub.current_period_end ?? new Date().toISOString();

    const admin = billingAdmin();
    await admin
      .from('subscriptions')
      .update({ pending_plan: newPlan, pending_plan_effective_at: effectiveAt })
      .eq('account_id', ctx.accountId);

    await admin.from('subscription_events').insert({
      account_id: ctx.accountId,
      event_type: 'downgrade_scheduled',
      from_plan: limits.plan,
      to_plan: newPlan,
      metadata: { effective_at: effectiveAt },
    });

    return NextResponse.json({
      success: true,
      pendingPlan: newPlan,
      effectiveAt,
      message: `Your plan will switch to ${newPlan} on ${new Date(effectiveAt).toLocaleDateString('en-IN')}`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
