'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { openRazorpayCheckout } from '@/lib/marketplace/checkout';
import { useCredits } from '@/hooks/useCredits';
import { useTopupModal } from '@/components/layout/topup-modal-context';

interface CreditPackageOption {
  key: string;
  name: string;
  credits: number;
  amountMinor: number;
  currency: string;
  gateway: 'razorpay' | 'stripe';
}

function formatPrice(amountMinor: number, currency: string): string {
  const amount = amountMinor / 100;
  const symbols: Record<string, string> = {
    INR: '₹',
    USD: '$',
    GBP: '£',
    EUR: '€',
    AED: 'AED ',
    SGD: 'S$',
    AUD: 'A$',
  };
  const symbol = symbols[currency] ?? `${currency} `;
  return `${symbol}${amount.toLocaleString()}`;
}

export function CreditTopup() {
  const { isOpen, closeTopupModal } = useTopupModal();
  const { refresh } = useCredits();
  const [packages, setPackages] = useState<CreditPackageOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [buyingKey, setBuyingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch('/api/billing/credits/packages')
      .then((res) => res.json())
      .then((json) => setPackages(json.packages ?? []))
      .catch(() => toast.error('Failed to load credit packages'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  async function handleBuy(pkg: CreditPackageOption) {
    setBuyingKey(pkg.key);
    try {
      const res = await fetch('/api/billing/credits/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageKey: pkg.key }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error ?? `Checkout failed: ${res.status}`);

      if (json.gateway === 'razorpay') {
        await openRazorpayCheckout({
          keyId: json.keyId,
          orderId: json.orderId,
          amount: json.amount,
          currency: json.currency,
          name: 'ConvoReal Credits',
          description: `${json.credits.toLocaleString()} credits (${json.packageName})`,
        });
        toast.success(
          `${json.credits.toLocaleString()} credits added to your wallet!`
        );
        await refresh();
        closeTopupModal();
      } else if (json.gateway === 'stripe' && json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Purchase failed';
      toast.error(msg);
    } finally {
      setBuyingKey(null);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeTopupModal()}>
      <DialogContent className="max-w-lg rounded-2xl border-slate-800 bg-slate-900/95 p-6 text-white backdrop-blur-md">
        <h2 className="mb-1 text-lg font-bold text-white">Buy Credits</h2>
        <p className="mb-4 text-sm text-slate-400">
          Purchased credits never expire.
        </p>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Loading packages...
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {packages.map((pkg) => (
              <button
                key={pkg.key}
                type="button"
                disabled={buyingKey !== null}
                onClick={() => handleBuy(pkg)}
                className="hover:border-primary/60 flex flex-col items-start gap-1 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-left transition-colors hover:bg-slate-800/60 disabled:opacity-50"
              >
                <span className="text-base font-bold text-white">
                  {pkg.credits.toLocaleString()} cr
                </span>
                <span className="text-primary text-sm font-medium">
                  {formatPrice(pkg.amountMinor, pkg.currency)}
                </span>
                <span className="text-xs text-slate-500">{pkg.name}</span>
                {buyingKey === pkg.key && (
                  <span className="mt-1 text-xs text-slate-400">
                    Processing...
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs text-slate-500">
          Consumed credits are non-refundable. An unused pack can be refunded
          within 7 days —{' '}
          <a
            href="/refund-policy"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-slate-300"
          >
            refund policy
          </a>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}
