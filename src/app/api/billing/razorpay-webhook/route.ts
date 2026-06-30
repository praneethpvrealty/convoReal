import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { billingAdmin } from '@/lib/billing/admin-client';
import type { Plan } from '@/lib/billing/types';

// POST /api/billing/razorpay-webhook
// Receives Razorpay subscription events and updates our DB.
// No auth — verified via HMAC-SHA256 signature.
// Register this URL in Razorpay Dashboard → Settings → Webhooks.

function verifyRazorpaySignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Maps Razorpay plan IDs back to our internal plan name.
// Built from the same env vars used in create-subscription.
function planFromRazorpayPlanId(rzPlanId: string): Plan | null {
  const plans: Plan[] = ['solo_pro', 'team', 'agency'];
  const cycles = ['monthly', 'annual'];
  for (const plan of plans) {
    for (const cycle of cycles) {
      const key = `RAZORPAY_PLAN_${plan.toUpperCase()}_${cycle.toUpperCase()}`;
      if (process.env[key] === rzPlanId) return plan;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature') ?? '';

  if (!verifyRazorpaySignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: { event: string; payload: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const admin = billingAdmin();
  const eventType: string = event.event;
  const payload = event.payload as Record<string, Record<string, unknown>>;
  const sub = payload?.subscription?.entity as Record<string, unknown> | undefined;

  if (!sub) {
    // Not a subscription event — acknowledge and ignore
    return NextResponse.json({ received: true });
  }

  const rzSubId: string = String(sub.id);

  // Look up our account by the Razorpay subscription ID
  const { data: ourSub } = await admin
    .from('subscriptions')
    .select('account_id, plan')
    .eq('razorpay_subscription_id', rzSubId)
    .maybeSingle();

  if (!ourSub) {
    console.warn('[razorpay-webhook] Unknown subscription:', rzSubId);
    return NextResponse.json({ received: true });
  }

  const { account_id, plan: currentPlan } = ourSub;

  switch (eventType) {
    case 'subscription.activated': {
      const rzPlanId = String(sub.plan_id ?? '');
      const newPlan = planFromRazorpayPlanId(rzPlanId) ?? currentPlan;
      await admin.from('subscriptions').update({
        status: 'active',
        plan: newPlan,
        current_period_start: new Date(Number(sub.current_start) * 1000).toISOString(),
        current_period_end: new Date(Number(sub.current_end) * 1000).toISOString(),
        razorpay_plan_id: rzPlanId,
      }).eq('account_id', account_id);

      await admin.from('subscription_events').insert({
        account_id,
        event_type: 'payment_succeeded',
        from_plan: currentPlan,
        to_plan: newPlan,
        razorpay_event_id: rzSubId,
        metadata: { razorpay_event: eventType },
      });
      break;
    }

    case 'subscription.charged': {
      const chargeEntity = (payload?.payment?.entity ?? {}) as Record<string, unknown>;
      await admin.from('subscriptions').update({
        status: 'active',
        current_period_start: new Date(Number(sub.current_start) * 1000).toISOString(),
        current_period_end: new Date(Number(sub.current_end) * 1000).toISOString(),
      }).eq('account_id', account_id);

      await admin.from('subscription_events').insert({
        account_id,
        event_type: 'payment_succeeded',
        from_plan: currentPlan,
        to_plan: currentPlan,
        razorpay_event_id: String(chargeEntity.id ?? rzSubId),
        metadata: { amount: chargeEntity.amount, razorpay_event: eventType },
      });
      break;
    }

    case 'subscription.payment_failed': {
      await admin.from('subscriptions').update({ status: 'past_due' })
        .eq('account_id', account_id);

      await admin.from('subscription_events').insert({
        account_id,
        event_type: 'payment_failed',
        from_plan: currentPlan,
        to_plan: currentPlan,
        razorpay_event_id: rzSubId,
        metadata: { razorpay_event: eventType },
      });
      break;
    }

    case 'subscription.cancelled':
    case 'subscription.canceled': {
      await admin.from('subscriptions').update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
      }).eq('account_id', account_id);

      await admin.from('subscription_events').insert({
        account_id,
        event_type: 'canceled',
        from_plan: currentPlan,
        to_plan: 'starter',
        razorpay_event_id: rzSubId,
        metadata: { razorpay_event: eventType },
      });
      break;
    }

    case 'subscription.completed': {
      // Annual plan completed — treat same as canceled unless they renew
      await admin.from('subscriptions').update({ status: 'canceled' })
        .eq('account_id', account_id);
      break;
    }

    default:
      // Unhandled event type — acknowledge and log
      console.log('[razorpay-webhook] Unhandled event:', eventType);
  }

  return NextResponse.json({ received: true });
}
