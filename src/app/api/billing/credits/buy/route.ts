import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getOrDetectBillingGateway } from '@/lib/credits/currency';
import { getPackagePrice } from '@/lib/credits/grant';
import { createRazorpayOrder } from '@/lib/marketplace/razorpay';
import { createStripeCheckoutSession, getStripeClient } from '@/lib/credits/stripe';

function getBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

// POST /api/billing/credits/buy
// Body: { packageKey: string }
// Creates a payment-provider order/session for a credit top-up
// package, in the account's detected currency/gateway. Available to
// any team member (agent+), not Manager-only — anyone hitting a
// zero-balance wall should be able to self-serve a purchase.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(`agent:buyCredits:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));
    const packageKey = String(body?.packageKey ?? '');
    if (!packageKey) {
      return NextResponse.json({ error: 'packageKey is required' }, { status: 400 });
    }

    const { currency, gateway } = await getOrDetectBillingGateway(ctx.accountId);
    const found = await getPackagePrice(packageKey, currency);
    if (!found) {
      return NextResponse.json({ error: `No price found for package "${packageKey}" in ${currency}` }, { status: 404 });
    }
    const { pkg, price } = found;

    if (gateway === 'razorpay') {
      const order = await createRazorpayOrder({
        amountCents: price.amount_minor,
        currency,
        receipt: `credits_${ctx.accountId.slice(0, 8)}_${pkg.key}`,
        notes: {
          type: 'credit_topup',
          account_id: ctx.accountId,
          package_key: pkg.key,
        },
      });

      return NextResponse.json({
        gateway: 'razorpay',
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: order.keyId,
        packageKey: pkg.key,
        packageName: pkg.name,
        credits: pkg.credits,
      });
    }

    // Stripe: hosted Checkout Session, redirect flow (no Stripe.js/Elements
    // needed client-side).
    if (!getStripeClient()) {
      console.error(`[billing/credits/buy] Stripe gateway resolved for account ${ctx.accountId} but STRIPE_SECRET_KEY is not set`);
      return NextResponse.json(
        { error: 'International payments are not yet available for your account. Please contact support.' },
        { status: 503 },
      );
    }

    const baseUrl = getBaseUrl();
    const session = await createStripeCheckoutSession({
      amountMinor: price.amount_minor,
      currency: currency.toLowerCase(),
      packageName: `${pkg.name} — ${pkg.credits.toLocaleString()} credits`,
      successUrl: `${baseUrl}/settings?tab=credits&topup=success`,
      cancelUrl: `${baseUrl}/settings?tab=credits&topup=canceled`,
      metadata: {
        type: 'credit_topup',
        account_id: ctx.accountId,
        package_key: pkg.key,
      },
    });

    return NextResponse.json({
      gateway: 'stripe',
      checkoutUrl: session.checkoutUrl,
      sessionId: session.sessionId,
      packageKey: pkg.key,
      packageName: pkg.name,
      credits: pkg.credits,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
