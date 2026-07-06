// ============================================================
// Stripe helpers for credit top-up purchases (non-INR currencies
// only — existing subscription plan billing stays Razorpay/INR-only
// and untouched).
//
// Mirrors src/lib/marketplace/razorpay.ts's shape as the one
// deliberate SDK exception in this codebase: Stripe's webhook
// signature scheme (timestamp + tolerance window) is fiddlier to
// hand-roll correctly than Razorpay's flat HMAC, and the Stripe Node
// SDK is the standard, low-risk way to do both
// `checkout.sessions.create` and `stripe.webhooks.constructEvent`.
// ============================================================

import Stripe from 'stripe';

let _client: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!_client) {
    _client = new Stripe(key);
  }
  return _client;
}

export interface StripeCheckoutInput {
  amountMinor: number; // smallest currency unit — matches amountCents naming convention in razorpay.ts
  currency: string; // lowercase Stripe convention: 'usd' | 'gbp' | 'eur' | 'aed' | 'sgd' | 'aud'
  packageName: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>; // { account_id, package_key, type: 'credit_topup' }
}

export interface StripeCheckoutResult {
  sessionId: string;
  checkoutUrl: string;
}

export async function createStripeCheckoutSession(input: StripeCheckoutInput): Promise<StripeCheckoutResult> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe is not configured. Add STRIPE_SECRET_KEY.');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: input.currency,
          product_data: { name: input.packageName },
          unit_amount: input.amountMinor,
        },
        quantity: 1,
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: input.metadata,
  });

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL');
  }

  return { sessionId: session.id, checkoutUrl: session.url };
}

export function verifyStripeWebhookSignature(rawBody: string, signature: string, secret: string): Stripe.Event {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe is not configured.');
  }
  // Throws on invalid signature — caller catches and returns 400.
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
