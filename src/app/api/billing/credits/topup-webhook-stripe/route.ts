import { NextRequest, NextResponse } from 'next/server';
import { verifyStripeWebhookSignature } from '@/lib/credits/stripe';
import { creditPurchase } from '@/lib/credits/grant';

// POST /api/billing/credits/topup-webhook-stripe
// Handles Stripe's `checkout.session.completed` for credit top-up
// purchases. Separate from the Razorpay webhook (which handles
// subscriptions + marketplace + its own credit_topup branch) since
// Stripe's signature verification scheme is entirely different —
// mixing the two in one route body would be confusing.
// No auth — verified via Stripe's signature header.
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe-topup-webhook] STRIPE_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';

  let event;
  try {
    event = verifyStripeWebhookSignature(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe-topup-webhook] signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as {
      id: string;
      metadata?: Record<string, string>;
      payment_intent?: string | { id: string };
      currency?: string;
    };

    if (session.metadata?.type === 'credit_topup') {
      const accountId = session.metadata.account_id;
      const packageKey = session.metadata.package_key;
      const paymentIntentId =
        typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? '');

      if (accountId && packageKey) {
        try {
          const result = await creditPurchase({
            accountId,
            packageKey,
            gateway: 'stripe',
            gatewayOrderId: session.id,
            gatewayPaymentId: paymentIntentId,
            currency: (session.currency ?? 'usd').toUpperCase(),
          });
          console.log('[stripe-topup-webhook] credit top-up:', { sessionId: session.id, ...result });
        } catch (err) {
          console.error('[stripe-topup-webhook] credit top-up processing failed:', err);
        }
      } else {
        console.warn('[stripe-topup-webhook] Credit top-up session missing required metadata');
      }
    }
  }

  // Always 200 to stop Stripe retries — same contract as the Razorpay webhook.
  return NextResponse.json({ received: true });
}
