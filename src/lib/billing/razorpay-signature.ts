import crypto from 'crypto';

/**
 * Verify a Razorpay webhook's `X-Razorpay-Signature` (HMAC-SHA256 of the
 * raw request body, keyed by the webhook secret). This one boolean gates
 * the entire money path behind the webhook — plan changes, credit grants,
 * marketplace enablement — so every branch is worth pinning.
 *
 * The length guard is load-bearing: `crypto.timingSafeEqual` throws on
 * buffers of unequal length, so a short/garbage signature must be
 * rejected before the comparison, not caught after it.
 */
export function verifyRazorpaySignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
