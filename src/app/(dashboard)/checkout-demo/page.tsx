"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CreditCard, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { openRazorpayCheckout } from "@/lib/marketplace/checkout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LogMessage {
  time: string;
  type: "info" | "success" | "error";
  text: string;
}

export default function CheckoutDemoPage() {
  const [amountInr, setAmountInr] = useState("500");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "success" | "error">("idle");

  const [prefillName, setPrefillName] = useState("John Doe");
  const [prefillEmail, setPrefillEmail] = useState("john.doe@example.com");
  const [prefillPhone, setPrefillPhone] = useState("+919999999999");

  function addLog(text: string, type: "info" | "success" | "error" = "info") {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, type, text }]);
  }

  async function handleCheckout() {
    setLoading(false);
    setPaymentStatus("idle");
    setLogs([]);

    const amountPaise = Math.round(parseFloat(amountInr) * 100);
    if (isNaN(amountPaise) || amountPaise < 100) {
      toast.error("Amount must be at least 1 INR (100 paise)");
      return;
    }

    setLoading(true);
    addLog(`Initiating order creation for ${amountInr} INR (${amountPaise} paise)...`);

    try {
      // Step 1: Create Order on backend
      const orderRes = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt: `demo_${Date.now().toString().slice(-6)}`,
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        throw new Error(orderData.error || `Order creation failed: ${orderRes.status}`);
      }

      addLog(`Order created successfully. Order ID: ${orderData.order_id}`, "success");
      addLog("Launching Razorpay Payment Modal...");

      // Step 2: Open Checkout Modal
      let paymentResponse;
      try {
        paymentResponse = await openRazorpayCheckout({
          keyId: orderData.keyId,
          orderId: orderData.order_id,
          amount: orderData.amount,
          currency: orderData.currency,
          name: "ConvoReal Standard Checkout",
          description: "Integration Verification & Test Payment",
          prefill: {
            name: prefillName,
            email: prefillEmail,
            contact: prefillPhone,
          },
        });
      } catch (modalErr: unknown) {
        const msg = modalErr instanceof Error ? modalErr.message : String(modalErr);
        addLog(`Payment cancelled or modal dismissed: ${msg}`, "error");
        setPaymentStatus("error");
        setLoading(false);
        return;
      }

      addLog(`Payment details received. Payment ID: ${paymentResponse.razorpay_payment_id}`, "success");
      addLog("Verifying payment signature with backend...");

      // Step 3: Verify Payment Signature on backend
      const verifyRes = await fetch("/api/verify-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentResponse),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || `Signature verification failed: ${verifyRes.status}`);
      }

      addLog("Payment signature verified successfully! Order is paid.", "success");
      setPaymentStatus("success");
      toast.success("Payment successful and verified!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Payment processing failed";
      addLog(`Error: ${msg}`, "error");
      setPaymentStatus("error");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex flex-col space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
          <CreditCard className="size-6 text-primary" />
          Razorpay Standard Web Checkout
        </h1>
        <p className="text-slate-400 text-sm">
          Test standard orders, payment modals, and backend signature verification using test-mode credentials.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Payment Settings Card */}
        <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-200">Checkout Settings</h2>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="checkout-amount" className="text-xs text-slate-400 font-semibold">
                Amount (INR)
              </Label>
              <Input
                id="checkout-amount"
                type="number"
                min="1"
                placeholder="500"
                value={amountInr}
                onChange={(e) => setAmountInr(e.target.value)}
                className="bg-slate-950 border-slate-800 text-slate-200 text-sm h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prefill-name" className="text-xs text-slate-400 font-semibold">
                Prefill Customer Name
              </Label>
              <Input
                id="prefill-name"
                value={prefillName}
                onChange={(e) => setPrefillName(e.target.value)}
                className="bg-slate-950 border-slate-800 text-slate-200 text-sm h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prefill-email" className="text-xs text-slate-400 font-semibold">
                Prefill Customer Email
              </Label>
              <Input
                id="prefill-email"
                type="email"
                value={prefillEmail}
                onChange={(e) => setPrefillEmail(e.target.value)}
                className="bg-slate-950 border-slate-800 text-slate-200 text-sm h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prefill-phone" className="text-xs text-slate-400 font-semibold">
                Prefill Customer Phone
              </Label>
              <Input
                id="prefill-phone"
                value={prefillPhone}
                onChange={(e) => setPrefillPhone(e.target.value)}
                className="bg-slate-950 border-slate-800 text-slate-200 text-sm h-9"
              />
            </div>
          </div>

          <Button
            onClick={handleCheckout}
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm h-10 select-none cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" /> Processing Order...
              </>
            ) : (
              <>Pay with Razorpay</>
            )}
          </Button>
        </div>

        {/* Console / Status Logs */}
        <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-5 flex flex-col h-[380px]">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-base font-bold text-slate-200">Execution Log</h2>
            {paymentStatus === "success" && (
              <span className="flex items-center gap-1 text-xs text-emerald-450 font-semibold bg-emerald-950/30 border border-emerald-900/50 px-2 py-0.5 rounded-full animate-fade-in">
                <CheckCircle2 className="size-3" /> Paid & Verified
              </span>
            )}
            {paymentStatus === "error" && (
              <span className="flex items-center gap-1 text-xs text-rose-450 font-semibold bg-rose-950/30 border border-rose-900/50 px-2 py-0.5 rounded-full animate-fade-in">
                <AlertCircle className="size-3" /> Failed
              </span>
            )}
          </div>

          <div className="bg-slate-950 rounded-lg p-3.5 flex-1 font-mono text-xs overflow-y-auto space-y-1 text-slate-300 border border-slate-900">
            {logs.length === 0 ? (
              <p className="text-slate-650 italic">Console logs will appear here once checkout starts...</p>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="flex gap-2 items-start animate-fade-in">
                  <span className="text-slate-550 shrink-0 select-none">[{log.time}]</span>
                  <span
                    className={
                      log.type === "success"
                        ? "text-emerald-400"
                        : log.type === "error"
                          ? "text-rose-400 font-semibold"
                          : "text-slate-300"
                    }
                  >
                    {log.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
