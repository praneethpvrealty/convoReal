/**
 * Razorpay order helpers for one-time marketplace purchases.
 *
 * Uses Razorpay Orders API (not subscriptions) so each flow/template
 * can be sold independently. Webhook handler in
 * /api/billing/razorpay-webhook/route.ts listens for `payment.captured`
 * and activates the provisioned flow.
 */

const RAZORPAY_API = "https://api.razorpay.com/v1";

export function getRazorpayCredentials(): { keyId: string; keySecret: string } | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

export interface RazorpayOrderInput {
  amountCents: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}

export interface RazorpayOrderResult {
  id: string;
  amount: number;
  currency: string;
  status: string;
  keyId: string;
}

export async function createRazorpayOrder(
  input: RazorpayOrderInput,
): Promise<RazorpayOrderResult> {
  const creds = getRazorpayCredentials();
  if (!creds) {
    throw new Error("Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }

  const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
  const res = await fetch(`${RAZORPAY_API}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: input.amountCents,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
    }),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.error("[marketplace/razorpay] order creation failed:", errBody);
    throw new Error(`Razorpay order failed: ${JSON.stringify(errBody)}`);
  }

  const order = (await res.json()) as Record<string, unknown>;
  return {
    id: String(order.id),
    amount: Number(order.amount),
    currency: String(order.currency),
    status: String(order.status),
    keyId: creds.keyId,
  };
}
