'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CreditCard, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { openRazorpayCheckout } from '@/lib/marketplace/checkout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LogMessage {
  time: string;
  type: 'info' | 'success' | 'error';
  text: string;
}

export default function CheckoutDemoPage() {
  const [amountInr, setAmountInr] = useState('500');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [paymentStatus, setPaymentStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');

  const [prefillName, setPrefillName] = useState('John Doe');
  const [prefillEmail, setPrefillEmail] = useState('john.doe@example.com');
  const [prefillPhone, setPrefillPhone] = useState('+919999999999');

  function addLog(text: string, type: 'info' | 'success' | 'error' = 'info') {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, type, text }]);
  }

  async function handleCheckout() {
    setLoading(false);
    setPaymentStatus('idle');
    setLogs([]);

    const amountPaise = Math.round(parseFloat(amountInr) * 100);
    if (isNaN(amountPaise) || amountPaise < 100) {
      toast.error('Amount must be at least 1 INR (100 paise)');
      return;
    }

    setLoading(true);
    addLog(
      `Initiating order creation for ${amountInr} INR (${amountPaise} paise)...`
    );

    try {
      // Step 1: Create Order on backend
      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: `demo_${Date.now().toString().slice(-6)}`,
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        throw new Error(
          orderData.error || `Order creation failed: ${orderRes.status}`
        );
      }

      addLog(
        `Order created successfully. Order ID: ${orderData.order_id}`,
        'success'
      );
      addLog('Launching Razorpay Payment Modal...');

      // Step 2: Open Checkout Modal
      let paymentResponse;
      try {
        paymentResponse = await openRazorpayCheckout({
          keyId: orderData.keyId,
          orderId: orderData.order_id,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'ConvoReal Standard Checkout',
          description: 'Integration Verification & Test Payment',
          prefill: {
            name: prefillName,
            email: prefillEmail,
            contact: prefillPhone,
          },
        });
      } catch (modalErr: unknown) {
        const msg =
          modalErr instanceof Error ? modalErr.message : String(modalErr);
        addLog(`Payment cancelled or modal dismissed: ${msg}`, 'error');
        setPaymentStatus('error');
        setLoading(false);
        return;
      }

      addLog(
        `Payment details received. Payment ID: ${paymentResponse.razorpay_payment_id}`,
        'success'
      );
      addLog('Verifying payment signature with backend...');

      // Step 3: Verify Payment Signature on backend
      const verifyRes = await fetch('/api/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentResponse),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(
          verifyData.error ||
            `Signature verification failed: ${verifyRes.status}`
        );
      }

      addLog(
        'Payment signature verified successfully! Order is paid.',
        'success'
      );
      setPaymentStatus('success');
      toast.success('Payment successful and verified!');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Payment processing failed';
      addLog(`Error: ${msg}`, 'error');
      setPaymentStatus('error');
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container max-w-4xl space-y-6 py-8">
      <div className="flex flex-col space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-100">
          <CreditCard className="text-primary size-6" />
          Razorpay Standard Web Checkout
        </h1>
        <p className="text-sm text-slate-400">
          Test standard orders, payment modals, and backend signature
          verification using test-mode credentials.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Payment Settings Card */}
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-base font-bold text-slate-200">
            Checkout Settings
          </h2>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="checkout-amount"
                className="text-xs font-semibold text-slate-400"
              >
                Amount (INR)
              </Label>
              <Input
                id="checkout-amount"
                type="number"
                min="1"
                placeholder="500"
                value={amountInr}
                onChange={(e) => setAmountInr(e.target.value)}
                className="h-9 border-slate-800 bg-slate-950 text-sm text-slate-200"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="prefill-name"
                className="text-xs font-semibold text-slate-400"
              >
                Prefill Customer Name
              </Label>
              <Input
                id="prefill-name"
                value={prefillName}
                onChange={(e) => setPrefillName(e.target.value)}
                className="h-9 border-slate-800 bg-slate-950 text-sm text-slate-200"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="prefill-email"
                className="text-xs font-semibold text-slate-400"
              >
                Prefill Customer Email
              </Label>
              <Input
                id="prefill-email"
                type="email"
                value={prefillEmail}
                onChange={(e) => setPrefillEmail(e.target.value)}
                className="h-9 border-slate-800 bg-slate-950 text-sm text-slate-200"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="prefill-phone"
                className="text-xs font-semibold text-slate-400"
              >
                Prefill Customer Phone
              </Label>
              <Input
                id="prefill-phone"
                value={prefillPhone}
                onChange={(e) => setPrefillPhone(e.target.value)}
                className="h-9 border-slate-800 bg-slate-950 text-sm text-slate-200"
              />
            </div>
          </div>

          <Button
            onClick={handleCheckout}
            disabled={loading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground h-10 w-full cursor-pointer text-sm font-semibold select-none"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> Processing
                Order...
              </>
            ) : (
              <>Pay with Razorpay</>
            )}
          </Button>
        </div>

        {/* Console / Status Logs */}
        <div className="flex h-[380px] flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-200">
              Execution Log
            </h2>
            {paymentStatus === 'success' && (
              <span className="text-emerald-450 animate-fade-in flex items-center gap-1 rounded-full border border-emerald-900/50 bg-emerald-950/30 px-2 py-0.5 text-xs font-semibold">
                <CheckCircle2 className="size-3" /> Paid & Verified
              </span>
            )}
            {paymentStatus === 'error' && (
              <span className="text-rose-450 animate-fade-in flex items-center gap-1 rounded-full border border-rose-900/50 bg-rose-950/30 px-2 py-0.5 text-xs font-semibold">
                <AlertCircle className="size-3" /> Failed
              </span>
            )}
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto rounded-lg border border-slate-900 bg-slate-950 p-3.5 font-mono text-xs text-slate-300">
            {logs.length === 0 ? (
              <p className="text-slate-650 italic">
                Console logs will appear here once checkout starts...
              </p>
            ) : (
              logs.map((log, index) => (
                <div
                  key={index}
                  className="animate-fade-in flex items-start gap-2"
                >
                  <span className="text-slate-550 shrink-0 select-none">
                    [{log.time}]
                  </span>
                  <span
                    className={
                      log.type === 'success'
                        ? 'text-emerald-400'
                        : log.type === 'error'
                          ? 'font-semibold text-rose-400'
                          : 'text-slate-300'
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
