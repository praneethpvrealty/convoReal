'use client';

import { useState } from 'react';
import { Check, X, Zap, Users, Building2, Crown, AlertTriangle, ExternalLink, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { usePlan } from '@/hooks/usePlan';
import { PLAN_CONFIG, PLAN_ORDER, isUpgrade, isDowngrade } from '@/lib/billing/plan-config';
import type { Plan, BillingCycle } from '@/lib/billing/types';
import { REFUND_GUARANTEE_BLURB } from '@/config/refund-policy';

// ── helpers ────────────────────────────────────────────────────────────────

function formatINR(amount: number) {
  return `₹${amount.toLocaleString('en-IN')}`;
}

function UsageMeter({ label, current, limit }: { label: string; current: number; limit: number }) {
  const isUnlimited = limit >= 999999;
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((current / limit) * 100));
  const isWarning = !isUnlimited && pct >= 80;
  const isFull = !isUnlimited && pct >= 100;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={isFull ? 'text-red-500 font-medium' : isWarning ? 'text-amber-500 font-medium' : 'text-foreground'}>
          {isUnlimited ? `${current.toLocaleString()} / Unlimited` : `${current.toLocaleString()} / ${limit.toLocaleString()}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isFull ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PlanIcon({ plan }: { plan: Plan }) {
  switch (plan) {
    case 'starter': return <Zap className="h-4 w-4" />;
    case 'solo_pro': return <Crown className="h-4 w-4" />;
    case 'team': return <Users className="h-4 w-4" />;
    case 'agency': return <Building2 className="h-4 w-4" />;
  }
}

function planBadgeVariant(plan: Plan): 'default' | 'secondary' | 'outline' {
  if (plan === 'agency') return 'default';
  if (plan === 'team') return 'default';
  if (plan === 'solo_pro') return 'secondary';
  return 'outline';
}

// ── PlanCard ───────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  currentPlan,
  cycle,
  onSelect,
}: {
  plan: Plan;
  currentPlan: Plan;
  cycle: BillingCycle;
  onSelect: (plan: Plan) => void;
}) {
  const config = PLAN_CONFIG[plan];
  const isCurrent = plan === currentPlan;
  const upgrading = isUpgrade(currentPlan, plan);
  const price = cycle === 'annual'
    ? config.annualMonthlyEquiv
    : cycle === 'quarterly'
    ? config.quarterlyMonthlyEquiv
    : config.monthlyPrice;

  return (
    <div
      className={`relative rounded-xl border-2 p-5 flex flex-col gap-4 transition-all ${
        isCurrent
          ? 'border-primary bg-primary/5'
          : config.highlighted
          ? 'border-blue-500/60'
          : 'border-border hover:border-primary/30'
      }`}
    >
      {config.highlighted && !isCurrent && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-semibold px-3 py-0.5 rounded-full">
          Most popular
        </span>
      )}

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <PlanIcon plan={plan} />
            <span className="font-semibold">{config.name}</span>
            {isCurrent && (
              <Badge variant="default" className="text-[10px] h-4 px-1.5">Current</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{config.tagline}</p>
        </div>
        <div className="text-right">
          {price === 0 ? (
            <span className="text-2xl font-bold">Free</span>
          ) : (
            <>
              <span className="text-2xl font-bold">{formatINR(price)}</span>
              <span className="text-xs text-muted-foreground">/mo</span>
              <div className="text-[10px] text-muted-foreground mt-0.5">+ 18% GST</div>
              {cycle === 'annual' && (
                <div className="text-xs text-emerald-600 font-medium">Billed annually</div>
              )}
              {cycle === 'quarterly' && (
                <div className="text-xs text-emerald-600 font-medium">Billed quarterly</div>
              )}
            </>
          )}
        </div>
      </div>

      <ul className="space-y-1.5 flex-1">
        {config.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs">
            <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
            <span>{f}</span>
          </li>
        ))}
        {config.notIncluded.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
            <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {!isCurrent && (
        <Button
          size="sm"
          variant={upgrading ? 'default' : 'outline'}
          onClick={() => onSelect(plan)}
          className="w-full"
        >
          {plan === 'starter' ? 'Downgrade to Free' : upgrading ? `Upgrade to ${config.name}` : `Switch to ${config.name}`}
        </Button>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function BillingTab() {
  const { plan, limits, usage, subscription, isLoading, refresh } = usePlan();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInvoices, setShowInvoices] = useState(false);
  const [invoices, setInvoices] = useState<unknown[]>([]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const pendingPlan = subscription?.pending_plan;
  const pendingDate = subscription?.pending_plan_effective_at
    ? new Date(subscription.pending_plan_effective_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  async function handlePlanSelect(target: Plan) {
    setSelectedPlan(target);
  }

  async function confirmPlanChange() {
    if (!selectedPlan) return;
    setIsProcessing(true);
    setError(null);

    try {
      if (isUpgrade(plan, selectedPlan)) {
        if (plan === 'starter') {
          // New subscription — redirect to Razorpay checkout
          const res = await fetch('/api/billing/create-subscription', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: selectedPlan, cycle }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to create subscription');
          if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
            return;
          }
        } else {
          // Upgrade existing subscription
          const res = await fetch('/api/billing/upgrade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: selectedPlan }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upgrade failed');
        }
      } else if (isDowngrade(plan, selectedPlan)) {
        const res = await fetch('/api/billing/downgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: selectedPlan }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Downgrade failed');
      }

      await refresh();
      setSelectedPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleCancelPendingDowngrade() {
    setIsProcessing(true);
    try {
      await fetch('/api/billing/downgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),  // re-select current plan cancels the pending change
      });
      await refresh();
    } finally {
      setIsProcessing(false);
    }
  }

  async function loadInvoices() {
    const res = await fetch('/api/billing/invoices');
    const data = await res.json();
    setInvoices(data.invoices ?? []);
    setShowInvoices(true);
  }

  const selectedConfig = selectedPlan ? PLAN_CONFIG[selectedPlan] : null;
  const selectedIsUpgrade = selectedPlan ? isUpgrade(plan, selectedPlan) : false;
  const selectedIsDowngrade = selectedPlan ? isDowngrade(plan, selectedPlan) : false;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Pending downgrade warning */}
      {pendingPlan && pendingDate && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              Your plan will switch to <strong>{PLAN_CONFIG[pendingPlan as Plan].name}</strong> on {pendingDate}.
              You keep current features until then.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancelPendingDowngrade}
              disabled={isProcessing}
              className="ml-4 shrink-0"
            >
              Cancel change
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Current plan summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <PlanIcon plan={plan} />
                {PLAN_CONFIG[plan].name} Plan
                <Badge variant={planBadgeVariant(plan)}>
                  {subscription?.status === 'past_due' ? 'Payment due' : 'Active'}
                </Badge>
              </CardTitle>
              {subscription?.current_period_end && (
                <CardDescription>
                  {subscription.status === 'canceled'
                    ? `Access until ${new Date(subscription.current_period_end).toLocaleDateString('en-IN')}`
                    : `Renews ${new Date(subscription.current_period_end).toLocaleDateString('en-IN')}`}
                </CardDescription>
              )}
            </div>
            {plan !== 'starter' && (
              <Button size="sm" variant="ghost" onClick={loadInvoices} className="text-xs gap-1">
                Invoices <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <UsageMeter
            label="Contacts"
            current={usage?.contacts ?? 0}
            limit={limits?.max_contacts ?? 50}
          />
          <UsageMeter
            label="Properties"
            current={usage?.properties ?? 0}
            limit={limits?.max_properties ?? 10}
          />
          <UsageMeter
            label="Team members"
            current={usage?.users ?? 1}
            limit={limits?.max_users ?? 1}
          />
          <p className="text-xs text-muted-foreground pt-1">
            {REFUND_GUARANTEE_BLURB}.{' '}
            <a href="/refund-policy" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              Refund policy
            </a>
          </p>
        </CardContent>
      </Card>

      {/* Billing cycle toggle */}
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setCycle('monthly')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
            cycle === 'monthly' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setCycle('quarterly')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${
            cycle === 'quarterly' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Quarterly
          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded">
            Save 8%
          </span>
        </button>
        <button
          onClick={() => setCycle('annual')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${
            cycle === 'annual' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Annual
          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded">
            2 months free
          </span>
        </button>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLAN_ORDER.map((p) => (
          <PlanCard
            key={p}
            plan={p}
            currentPlan={plan}
            cycle={cycle}
            onSelect={handlePlanSelect}
          />
        ))}
      </div>

      {/* Invoices */}
      {showInvoices && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Invoice history</CardTitle>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowInvoices(false)}>
                <ChevronUp className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <div className="divide-y">
                {(invoices as Array<Record<string, unknown>>).map((inv) => (
                  <div key={String(inv.id)} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">
                      {new Date(Number(inv.date) * 1000).toLocaleDateString('en-IN')}
                    </span>
                    <span>
                      {String(inv.currency ?? 'INR')} {Number(inv.amount) / 100}
                    </span>
                    <Badge variant={inv.status === 'paid' ? 'default' : 'secondary'} className="text-xs">
                      {String(inv.status)}
                    </Badge>
                    {inv.short_url != null && (
                      <a
                        href={String(inv.short_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-0.5"
                      >
                        View <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plan change confirmation dialog */}
      <Dialog open={!!selectedPlan} onOpenChange={(open) => !open && setSelectedPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedIsUpgrade ? `Upgrade to ${selectedConfig?.name}` : `Switch to ${selectedConfig?.name}`}
            </DialogTitle>
            <DialogDescription>
              {selectedIsUpgrade && selectedConfig?.monthlyPrice === 0 === false
                ? selectedIsDowngrade
                  ? `Your plan will change to ${selectedConfig?.name} at the end of your current billing cycle. You keep all current features until then.`
                  : `You'll be charged a prorated amount for the remaining days in your current cycle. New features unlock immediately.`
                : `Switch to the free plan at the end of your billing cycle.`}
            </DialogDescription>
          </DialogHeader>

          {selectedConfig && (
            <div className="border rounded-lg p-4 space-y-2">
              {selectedConfig.features.slice(0, 5).map((f) => (
                <div key={f} className="flex items-center gap-2 text-sm">
                  <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}

          {selectedIsDowngrade && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                If your current usage exceeds {selectedConfig?.name} limits, affected features will enter a 7-day grace period.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm text-red-500">{error}</AlertDescription>
            </Alert>
          )}

          {selectedIsUpgrade && (
            <p className="text-xs text-muted-foreground">
              By upgrading you agree to our{' '}
              <a href="/terms" target="_blank" rel="noreferrer" className="underline hover:text-foreground">Terms</a>{' '}
              and{' '}
              <a href="/refund-policy" target="_blank" rel="noreferrer" className="underline hover:text-foreground">Refund Policy</a>.
              {' '}Cancel anytime — no lock-in.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedPlan(null)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={confirmPlanChange} disabled={isProcessing}>
              {isProcessing
                ? 'Processing…'
                : selectedIsUpgrade
                ? `Upgrade — ${formatINR(
                    cycle === 'annual'
                      ? (selectedConfig?.annualPrice ?? 0)
                      : cycle === 'quarterly'
                      ? (selectedConfig?.quarterlyPrice ?? 0)
                      : (selectedConfig?.monthlyPrice ?? 0)
                  )}`
                : 'Confirm change'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
