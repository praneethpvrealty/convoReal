/**
 * Client-side Razorpay Checkout loader for one-time marketplace orders.
 *
 * Loads the Razorpay checkout script on demand, opens the payment
 * modal, and returns the resulting payment_id. The caller posts the
 * payment_id back to the server (or relies on the webhook) to confirm
 * activation.
 */

export interface RazorpayCheckoutOptions {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
}

export interface RazorpayPaymentResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

let scriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as Record<string, unknown>).Razorpay) return Promise.resolve();

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout script"));
    document.body.appendChild(script);
  });
  return scriptPromise;
}

export async function openRazorpayCheckout(
  options: RazorpayCheckoutOptions,
): Promise<RazorpayPaymentResponse> {
  await loadRazorpayScript();

  const Razorpay = (window as unknown as Record<string, unknown>).Razorpay as
    | {
        new (config: Record<string, unknown>): {
          open: () => void;
          on: (event: string, handler: (response: Record<string, unknown>) => void) => void;
        };
      }
    | undefined;

  if (!Razorpay) {
    throw new Error("Razorpay checkout is not available");
  }

  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: options.keyId,
      amount: options.amount,
      currency: options.currency,
      name: options.name,
      description: options.description ?? "Marketplace purchase",
      order_id: options.orderId,
      prefill: options.prefill ?? {},
      theme: { color: "#6366f1" },
      handler: (response: RazorpayPaymentResponse) => {
        resolve(response);
      },
    });

    rzp.on("payment.failed", (response: Record<string, unknown>) => {
      const error = (response.error as Record<string, unknown>) ?? {};
      reject(new Error(String(error.description ?? "Payment failed")));
    });

    rzp.open();
  });
}
