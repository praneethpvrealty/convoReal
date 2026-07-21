import { NextRequest, NextResponse } from 'next/server';
import { billingAdmin } from '@/lib/billing/admin-client';
import { verifyRazorpaySignature } from '@/lib/billing/razorpay-signature';
import type { Plan } from '@/lib/billing/types';
import { creditPurchase, grantSubscriptionCredits } from '@/lib/credits/grant';
import { processReferralConversion } from '@/lib/credits/referral';
import type { SubscriptionPlanForCredits } from '@/lib/credits/types';

// POST /api/billing/razorpay-webhook
// Receives Razorpay subscription events and one-time marketplace order
// payments. Updates our DB accordingly.
// No auth — verified via HMAC-SHA256 signature.
// Register this URL in Razorpay Dashboard → Settings → Webhooks.

// Maps Razorpay plan IDs back to our internal plan name.
// Built from the same env vars used in create-subscription.
async function handleMarketplacePayment(
  admin: ReturnType<typeof billingAdmin>,
  orderId: string,
  paymentId: string,
): Promise<NextResponse> {
  const { data: accountItem } = await admin
    .from('account_marketplace_items')
    .select('id, flow_id')
    .eq('razorpay_order_id', orderId)
    .maybeSingle();

  if (!accountItem || !accountItem.flow_id) {
    console.warn('[razorpay-webhook] Unknown marketplace order:', orderId);
    return NextResponse.json({ received: true });
  }

  await admin.from('account_marketplace_items')
    .update({
      status: 'purchased',
      purchased_at: new Date().toISOString(),
      razorpay_payment_id: paymentId,
    })
    .eq('id', accountItem.id);

  // Auto-activate the flow copy so the user doesn't need a second click.
  await admin.from('flows')
    .update({ status: 'active' })
    .eq('id', accountItem.flow_id);

  await admin.from('account_marketplace_items')
    .update({ status: 'enabled' })
    .eq('id', accountItem.id);

  console.log('[razorpay-webhook] Marketplace item enabled for order:', orderId);
  return NextResponse.json({ received: true });
}

async function handleCreditTopupPayment(
  orderId: string,
  paymentId: string,
  accountId: string,
  packageKey: string,
): Promise<NextResponse> {
  try {
    // creditPurchase() is idempotent on gateway_order_id — safe on
    // webhook redelivery.
    const result = await creditPurchase({
      accountId,
      packageKey,
      gateway: 'razorpay',
      gatewayOrderId: orderId,
      gatewayPaymentId: paymentId,
      currency: 'INR',
    });
    console.log('[razorpay-webhook] credit top-up:', { orderId, ...result });
  } catch (err) {
    console.error('[razorpay-webhook] credit top-up processing failed:', err);
  }
  return NextResponse.json({ received: true });
}

function isPaidPlan(plan: string): plan is SubscriptionPlanForCredits {
  return plan === 'solo_pro' || plan === 'team' || plan === 'agency';
}

function planFromRazorpayPlanId(rzPlanId: string): Plan | null {
  const plans: Plan[] = ['solo_pro', 'team', 'agency'];
  const cycles = ['monthly', 'quarterly', 'annual'];
  for (const plan of plans) {
    for (const cycle of cycles) {
      const key = `RAZORPAY_PLAN_${plan.toUpperCase()}_${cycle.toUpperCase()}`;
      if (process.env[key] === rzPlanId) return plan;
    }
  }
  return null;
}

// Same env-var convention as planFromRazorpayPlanId — the billing
// cycle isn't a field on the Razorpay subscription entity itself,
// it's implied by which RAZORPAY_PLAN_*_{MONTHLY|QUARTERLY|ANNUAL} env var
// matches this plan_id. Defaults to 'monthly' (0% commitment bonus)
// when unmatched, so an unrecognized plan_id never over-grants.
function cycleFromRazorpayPlanId(rzPlanId: string): 'monthly' | 'quarterly' | 'annual' {
  const plans: Plan[] = ['solo_pro', 'team', 'agency'];
  const cycles: ('monthly' | 'quarterly' | 'annual')[] = ['monthly', 'quarterly', 'annual'];
  for (const plan of plans) {
    for (const cycle of cycles) {
      const key = `RAZORPAY_PLAN_${plan.toUpperCase()}_${cycle.toUpperCase()}`;
      if (process.env[key] === rzPlanId) return cycle;
    }
  }
  return 'monthly';
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

  let event: { event: string; id?: string; payload: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const admin = billingAdmin();
  const eventType: string = event.event;
  const payload = event.payload as Record<string, Record<string, unknown>>;

  // Marketplace one-time payments are under payload.payment.entity and
  // carry an order_id in their notes.
  const payment = payload?.payment?.entity as Record<string, unknown> | undefined;
  if (payment && (eventType === 'payment.captured' || eventType === 'order.paid')) {
    const notes = (payment.notes ?? {}) as Record<string, unknown>;
    if (notes?.type === 'marketplace_purchase') {
      const orderId = String(payment.order_id ?? '');
      if (!orderId) {
        console.warn('[razorpay-webhook] Marketplace payment without order_id');
        return NextResponse.json({ received: true });
      }
      return await handleMarketplacePayment(admin, orderId, String(payment.id ?? ''));
    }
    if (notes?.type === 'credit_topup') {
      const orderId = String(payment.order_id ?? '');
      const accountId = String(notes.account_id ?? '');
      const packageKey = String(notes.package_key ?? '');
      if (!orderId || !accountId || !packageKey) {
        console.warn('[razorpay-webhook] Credit top-up payment missing required fields');
        return NextResponse.json({ received: true });
      }
      return await handleCreditTopupPayment(orderId, String(payment.id ?? ''), accountId, packageKey);
    }
  }

  // Subscription events are under payload.subscription.entity.
  const sub = payload?.subscription?.entity as Record<string, unknown> | undefined;
  if (!sub) {
    // Not a subscription event and not a marketplace payment — acknowledge.
    return NextResponse.json({ received: true });
  }

  const rzSubId: string = String(sub.id);

  // Dedup reference: Razorpay's event id when present, else the
  // per-charge payment id. Deliberately NOT the subscription id — that
  // repeats across every renewal, so deduping on it would silently drop
  // a legitimate later charge. Razorpay redelivers webhooks, and some
  // deliveries arrive with no top-level event id, so we dedup on
  // whatever stable per-event ref we have and store that SAME ref on the
  // subscription_events row below (so the next redelivery finds it).
  const paymentId = payment?.id ? String(payment.id) : null;
  const dedupRef = event.id || paymentId;
  if (dedupRef) {
    const { data: existingEvent } = await admin
      .from('subscription_events')
      .select('id')
      .eq('razorpay_event_id', dedupRef)
      .maybeSingle();

    if (existingEvent) {
      console.log(`[razorpay-webhook] Subscription event ${dedupRef} already processed.`);
      return NextResponse.json({ received: true });
    }
  }

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
      const periodEnd = new Date(Number(sub.current_end) * 1000).toISOString();
      await admin.from('subscriptions').update({
        status: 'active',
        plan: newPlan,
        current_period_start: new Date(Number(sub.current_start) * 1000).toISOString(),
        current_period_end: periodEnd,
        razorpay_plan_id: rzPlanId,
      }).eq('account_id', account_id);

      await admin.from('subscription_events').insert({
        account_id,
        event_type: 'payment_succeeded',
        from_plan: currentPlan,
        to_plan: newPlan,
        razorpay_event_id: dedupRef || rzSubId,
        metadata: { razorpay_event: eventType },
      });

      // Every activation represents entering a (new or renewed)
      // committed term — Razorpay only bills once per chosen cycle
      // length, so there's no "plain renewal within a term" case to
      // distinguish here, unlike a naive month-by-month reading of
      // the design doc might suggest.
      if (isPaidPlan(newPlan)) {
        const cycle = cycleFromRazorpayPlanId(rzPlanId);
        const creditCycle = cycle === 'quarterly' ? '3month' : cycle;
        await grantSubscriptionCredits(account_id, newPlan, creditCycle, { isNewCycle: true, periodEnd }).catch((err) =>
          console.error('[razorpay-webhook] grantSubscriptionCredits failed:', err),
        );
        await processReferralConversion(account_id, newPlan).catch((err) =>
          console.error('[razorpay-webhook] processReferralConversion failed:', err),
        );
      }
      break;
    }

    case 'subscription.charged': {
      const chargeEntity = (payload?.payment?.entity ?? {}) as Record<string, unknown>;
      const periodEnd = new Date(Number(sub.current_end) * 1000).toISOString();
      await admin.from('subscriptions').update({
        status: 'active',
        current_period_start: new Date(Number(sub.current_start) * 1000).toISOString(),
        current_period_end: periodEnd,
      }).eq('account_id', account_id);

      await admin.from('subscription_events').insert({
        account_id,
        event_type: 'payment_succeeded',
        from_plan: currentPlan,
        to_plan: currentPlan,
        razorpay_event_id: dedupRef || rzSubId,
        metadata: { amount: chargeEntity.amount, razorpay_event: eventType },
      });

      if (isPaidPlan(currentPlan)) {
        const cycle = cycleFromRazorpayPlanId(String(sub.plan_id ?? ''));
        const creditCycle = cycle === 'quarterly' ? '3month' : cycle;
        await grantSubscriptionCredits(account_id, currentPlan, creditCycle, { isNewCycle: true, periodEnd }).catch((err) =>
          console.error('[razorpay-webhook] grantSubscriptionCredits failed:', err),
        );
      }
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
        razorpay_event_id: dedupRef || rzSubId,
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
        razorpay_event_id: dedupRef || rzSubId,
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
