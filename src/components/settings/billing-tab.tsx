'use client';

import { useState } from 'react';
import {
  Check,
  X,
  Zap,
  Users,
  Building2,
  Crown,
  AlertTriangle,
  ExternalLink,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { usePlan } from '@/hooks/usePlan';
import {
  PLAN_CONFIG,
  PLAN_ORDER,
  isUpgrade,
  isDowngrade,
} from '@/lib/billing/plan-config';
import type { Plan, BillingCycle } from '@/lib/billing/types';
import { REFUND_GUARANTEE_BLURB } from '@/config/refund-policy';
import { formatInrPlain } from '@/lib/format/currency';

// ── helpers ────────────────────────────────────────────────────────────────

function UsageMeter({
  label,
  current,
  limit,
}: {
  label: string;
  current: number;
  limit: number;
}) {
  const isUnlimited = limit >= 999999;
  const pct = isUnlimited
    ? 0
    : Math.min(100, Math.round((current / limit) * 100));
  const isExceeded = !isUnlimited && current > limit;
  const isWarningOrFull = !isUnlimited && (current === limit || pct >= 80);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={
            isExceeded
              ? 'font-medium text-red-500'
              : isWarningOrFull
                ? 'font-medium text-amber-500'
                : 'text-foreground'
          }
        >
          {isUnlimited
            ? `${current.toLocaleString()} / Unlimited`
            : `${current.toLocaleString()} / ${limit.toLocaleString()}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div
            className={`h-full rounded-full transition-all ${isExceeded ? 'bg-red-500' : isWarningOrFull ? 'bg-amber-500' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PlanIcon({ plan }: { plan: Plan }) {
  switch (plan) {
    case 'starter':
      return <Zap className="h-4 w-4" />;
    case 'solo_pro':
      return <Crown className="h-4 w-4" />;
    case 'team':
      return <Users className="h-4 w-4" />;
    case 'agency':
      return <Building2 className="h-4 w-4" />;
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
  const price =
    cycle === 'annual'
      ? config.annualMonthlyEquiv
      : cycle === 'quarterly'
        ? config.quarterlyMonthlyEquiv
        : config.monthlyPrice;

  return (
    <div
      className={`relative flex flex-col gap-4 rounded-xl border-2 p-5 transition-all ${
        isCurrent
          ? 'border-primary bg-primary/5'
          : config.highlighted
            ? 'border-blue-500/60'
            : 'border-border hover:border-primary/30'
      }`}
    >
      {config.highlighted && !isCurrent && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-3 py-0.5 text-xs font-semibold text-white">
          Most popular
        </span>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <PlanIcon plan={plan} />
            <span className="truncate font-semibold">{config.name}</span>
            {isCurrent && (
              <Badge
                variant="default"
                className="h-4 shrink-0 px-1.5 text-[10px]"
              >
                Current
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs">{config.tagline}</p>
        </div>
        <div className="shrink-0 text-right">
          {price === 0 ? (
            <span className="text-2xl font-bold">Free</span>
          ) : (
            <>
              <div className="whitespace-nowrap">
                <span className="text-2xl font-bold">
                  {formatInrPlain(price)}
                </span>
                <span className="text-muted-foreground text-xs">/mo</span>
              </div>
              <div className="text-muted-foreground mt-0.5 text-[10px]">
                + 18% GST
              </div>
              {cycle === 'annual' && (
                <div className="text-xs font-medium text-emerald-600">
                  {formatInrPlain(config.annualPrice)} billed annually
                </div>
              )}
              {cycle === 'quarterly' && (
                <div className="text-xs font-medium text-emerald-600">
                  {formatInrPlain(config.quarterlyPrice)} billed quarterly
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ul className="flex-1 space-y-1.5">
        {config.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span>{f}</span>
          </li>
        ))}
        {config.notIncluded.map((f) => (
          <li
            key={f}
            className="text-muted-foreground flex items-start gap-2 text-xs"
          >
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {config.contactSalesNote && (
        <p className="text-muted-foreground border-border border-t pt-3 text-[11px] italic">
          {config.contactSalesNote}
        </p>
      )}

      {!isCurrent && (
        <Button
          size="sm"
          variant={upgrading ? 'default' : 'outline'}
          onClick={() => onSelect(plan)}
          className="w-full"
        >
          {plan === 'starter'
            ? 'Downgrade to Free'
            : upgrading
              ? `Upgrade to ${config.name}`
              : `Switch to ${config.name}`}
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
          <div key={i} className="bg-muted h-24 animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  const pendingPlan = subscription?.pending_plan;
  const pendingDate = subscription?.pending_plan_effective_at
    ? new Date(subscription.pending_plan_effective_at).toLocaleDateString(
        'en-IN',
        { day: 'numeric', month: 'long', year: 'numeric' }
      )
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
          if (!res.ok)
            throw new Error(data.error || 'Failed to create subscription');
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
        body: JSON.stringify({ plan }), // re-select current plan cancels the pending change
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
  const selectedIsUpgrade = selectedPlan
    ? isUpgrade(plan, selectedPlan)
    : false;
  const selectedIsDowngrade = selectedPlan
    ? isDowngrade(plan, selectedPlan)
    : false;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Pending downgrade warning */}
      {pendingPlan && pendingDate && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              Your plan will switch to{' '}
              <strong>{PLAN_CONFIG[pendingPlan as Plan].name}</strong> on{' '}
              {pendingDate}. You keep current features until then.
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
              <CardTitle className="flex items-center gap-2 text-base">
                <PlanIcon plan={plan} />
                {PLAN_CONFIG[plan].name} Plan
                <Badge variant={planBadgeVariant(plan)}>
                  {subscription?.status === 'past_due'
                    ? 'Payment due'
                    : 'Active'}
                </Badge>
              </CardTitle>
              {(limits?.effective_period_end ??
                subscription?.current_period_end) && (
                <CardDescription>
                  {subscription?.status === 'canceled'
                    ? `Access until ${new Date(limits?.effective_period_end ?? subscription!.current_period_end!).toLocaleDateString('en-IN')}`
                    : `Renews ${new Date(limits?.effective_period_end ?? subscription!.current_period_end!).toLocaleDateString('en-IN')}`}
                  {(limits?.extension_days ?? 0) > 0 && (
                    <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                      · includes {limits!.extension_days} day
                      {limits!.extension_days === 1 ? '' : 's'} of service
                      credit
                    </span>
                  )}
                </CardDescription>
              )}
            </div>
            {plan !== 'starter' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={loadInvoices}
                className="gap-1 text-xs"
              >
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
          <p className="text-muted-foreground pt-1 text-xs">
            {plan === 'starter'
              ? 'Upgrades are covered by our 7-day money-back guarantee. No lock-in.'
              : `${REFUND_GUARANTEE_BLURB}.`}{' '}
            <a
              href="/refund-policy"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground underline"
            >
              Refund policy
            </a>
          </p>
        </CardContent>
      </Card>

      {/* Billing cycle toggle */}
      <div className="bg-muted flex w-fit items-center gap-1 rounded-lg p-1">
        <button
          onClick={() => setCycle('monthly')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
            cycle === 'monthly'
              ? 'bg-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setCycle('quarterly')}
          className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
            cycle === 'quarterly'
              ? 'bg-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Quarterly
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-950">
            Save 8%
          </span>
        </button>
        <button
          onClick={() => setCycle('annual')}
          className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
            cycle === 'annual'
              ? 'bg-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Annual
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-950">
            2 months free
          </span>
        </button>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setShowInvoices(false)}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="text-muted-foreground text-sm">No invoices yet.</p>
            ) : (
              <div className="divide-y">
                {(invoices as Array<Record<string, unknown>>).map((inv) => (
                  <div
                    key={String(inv.id)}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {new Date(Number(inv.date) * 1000).toLocaleDateString(
                        'en-IN'
                      )}
                    </span>
                    <span>
                      {String(inv.currency ?? 'INR')} {Number(inv.amount) / 100}
                    </span>
                    <Badge
                      variant={inv.status === 'paid' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {String(inv.status)}
                    </Badge>
                    {inv.short_url != null && (
                      <a
                        href={String(inv.short_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary flex items-center gap-0.5 text-xs hover:underline"
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
      <Dialog
        open={!!selectedPlan}
        onOpenChange={(open) => !open && setSelectedPlan(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedIsUpgrade
                ? `Upgrade to ${selectedConfig?.name}`
                : `Switch to ${selectedConfig?.name}`}
            </DialogTitle>
            <DialogDescription>
              {selectedIsUpgrade
                ? `You'll be charged a prorated amount for the remaining days in your current cycle. New features unlock immediately.`
                : selectedPlan === 'starter'
                  ? `Switch to the free plan at the end of your billing cycle.`
                  : `Your plan will change to ${selectedConfig?.name} at the end of your current billing cycle. You keep all current features until then.`}
            </DialogDescription>
          </DialogHeader>

          {selectedConfig && (
            <div className="space-y-2 rounded-lg border p-4">
              {selectedConfig.features.slice(0, 5).map((f) => (
                <div key={f} className="flex items-center gap-2 text-sm">
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}

          {selectedIsDowngrade && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                If your current usage exceeds {selectedConfig?.name} limits,
                affected features will enter a 7-day grace period.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm text-red-500">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {selectedIsUpgrade && (
            <p className="text-muted-foreground text-xs">
              By upgrading you agree to our{' '}
              <a
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground underline"
              >
                Terms
              </a>{' '}
              and{' '}
              <a
                href="/refund-policy"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground underline"
              >
                Refund Policy
              </a>
              . Cancel anytime — no lock-in.
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedPlan(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button onClick={confirmPlanChange} disabled={isProcessing}>
              {isProcessing
                ? 'Processing…'
                : selectedIsUpgrade
                  ? `Upgrade — ${formatInrPlain(
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
