'use client';

import { useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface RazorpayOrder {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  package_key: string;
}

export function VerifyPaymentsButton() {
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [orders, setOrders] = useState<RazorpayOrder[]>([]);
  const [showDialog, setShowDialog] = useState(false);

  async function fetchPendingOrders() {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/credits/pending-razorpay');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to fetch pending orders');
      }

      setOrders(data.orders ?? []);
      setShowDialog(true);

      if ((data.orders ?? []).length === 0) {
        toast.info('No pending payments found in the last 24 hours');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to fetch pending orders';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function verifyPayment(orderId: string) {
    setVerifying(orderId);
    try {
      const res = await fetch('/api/billing/credits/verify-razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? data.message ?? 'Verification failed');
      }

      if (data.success) {
        toast.success(data.message);
        // Remove the verified order from the list
        setOrders((prev) => prev.filter((o) => o.order_id !== orderId));
      } else {
        toast.warning(data.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      toast.error(msg);
    } finally {
      setVerifying(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={fetchPendingOrders}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        Verify Payments
      </button>

      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Pending Payments</h3>
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="text-slate-400 hover:text-white"
              >
                <XCircle className="size-5" />
              </button>
            </div>

            {orders.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                No pending payments found in the last 24 hours.
              </p>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-lg border border-slate-800 bg-slate-800/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs text-slate-300">
                          {order.order_id}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {new Date(order.created_at).toLocaleString()}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-xs font-bold text-yellow-400">
                            ₹{(order.amount / 100).toFixed(2)}
                          </span>
                          <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">
                            {order.package_key}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => verifyPayment(order.order_id)}
                        disabled={verifying === order.order_id}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        {verifying === order.order_id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-3" />
                        )}
                        Verify
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
