'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Banknote, Building, CreditCard, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart } from '@/components/tremor/bar-chart';
import { PLAN_CONFIG, PLAN_ORDER } from '@/lib/billing/plan-config';
import type {
  BillingSummary,
  MonthlyBillingPoint,
  PlanBreakdownRow,
  RecentSubscriptionEvent,
} from '@/lib/billing/analytics';
import type { Plan } from '@/lib/billing/types';

interface BillingAnalyticsResponse {
  summary: BillingSummary;
  plans: PlanBreakdownRow[];
  monthly: MonthlyBillingPoint[];
  recentEvents: RecentSubscriptionEvent[];
}

const EVENT_LABELS: Record<string, string> = {
  upgraded: 'Upgraded',
  downgraded: 'Downgraded',
  canceled: 'Canceled',
  payment_succeeded: 'Payment',
  payment_failed: 'Payment failed',
  trial_started: 'Trial started',
};

const EVENT_BADGE_CLASSES: Record<string, string> = {
  upgraded: 'bg-emerald-500/10 text-emerald-400',
  downgraded: 'bg-amber-500/10 text-amber-400',
  canceled: 'bg-pink-500/10 text-pink-400',
  payment_succeeded: 'bg-violet-500/10 text-violet-400',
  payment_failed: 'bg-red-500/10 text-red-400',
  trial_started: 'bg-cyan-500/10 text-cyan-400',
};

function formatINR(amount: number) {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function monthLabel(month: string) {
  return format(new Date(`${month}-01T00:00:00`), 'MMM yy');
}

function planName(plan: Plan | string | null) {
  if (!plan) return '—';
  return PLAN_CONFIG[plan as Plan]?.name ?? plan;
}

export default function BillingTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-billing-analytics'],
    queryFn: async (): Promise<BillingAnalyticsResponse> => {
      const res = await fetch('/api/admin/billing-analytics');
      if (!res.ok) throw new Error('Failed to load billing analytics');
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <p className="py-16 text-center text-sm text-slate-500">
        Loading billing analytics...
      </p>
    );
  }

  if (isError || !data) {
    return (
      <p className="py-16 text-center text-sm text-red-400">
        Failed to load billing analytics. Ensure the billing_analytics database
        function is deployed (migration 179).
      </p>
    );
  }

  const { summary, monthly, recentEvents } = data;
  const currentMonth = monthly[monthly.length - 1];
  const revenueThisMonth = currentMonth
    ? currentMonth.subscriptionRevenue + currentMonth.topupRevenue
    : 0;

  const revenueData = monthly.map((m) => ({
    month: monthLabel(m.month),
    Subscriptions: m.subscriptionRevenue,
    'Top-ups': m.topupRevenue,
  }));

  const movementData = monthly.map((m) => ({
    month: monthLabel(m.month),
    Upgrades: m.upgrades,
    Downgrades: m.downgrades,
    Cancellations: m.cancellations,
  }));

  const accountsData = monthly.map((m) => ({
    month: monthLabel(m.month),
    'New accounts': m.newAccounts,
  }));

  const tiles = [
    {
      title: 'MRR',
      value: formatINR(summary.mrr),
      sub: 'Normalized to monthly',
      icon: TrendingUp,
    },
    {
      title: 'Paid Subscriptions',
      value: summary.paidAccounts.toLocaleString(),
      sub: 'Active, past due or in grace',
      icon: CreditCard,
    },
    {
      title: 'Total Accounts',
      value: summary.totalAccounts.toLocaleString(),
      sub: `${summary.planCounts.starter.toLocaleString()} on Starter`,
      icon: Building,
    },
    {
      title: 'Revenue This Month',
      value: formatINR(revenueThisMonth),
      sub: 'Subscriptions + credit top-ups',
      icon: Banknote,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card
            key={tile.title}
            className="border-slate-700 bg-slate-900 ring-0 ring-transparent"
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold text-slate-400">
                {tile.title}
              </CardTitle>
              <tile.icon className="text-primary h-4 w-4" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-white">{tile.value}</div>
              <p className="mt-1 text-xs text-slate-500">{tile.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">
            Revenue by Month
          </h3>
          <BarChart
            data={revenueData}
            index="month"
            categories={['Subscriptions', 'Top-ups']}
            colors={['violet', 'cyan']}
            type="stacked"
            valueFormatter={(value) => formatINR(value)}
            className="h-[260px]"
          />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">
            Plan Movement by Month
          </h3>
          <BarChart
            data={movementData}
            index="month"
            categories={['Upgrades', 'Downgrades', 'Cancellations']}
            colors={['emerald', 'amber', 'pink']}
            valueFormatter={(value) => value.toLocaleString()}
            className="h-[260px]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">
            New Accounts by Month
          </h3>
          <BarChart
            data={accountsData}
            index="month"
            categories={['New accounts']}
            colors={['blue']}
            valueFormatter={(value) => value.toLocaleString()}
            showLegend={false}
            className="h-[260px]"
          />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">
            Plan Distribution &amp; MRR
          </h3>
          <div className="space-y-3">
            {PLAN_ORDER.map((plan) => {
              const count = summary.planCounts[plan];
              const share =
                summary.totalAccounts > 0
                  ? (count / summary.totalAccounts) * 100
                  : 0;
              return (
                <div key={plan}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-300">
                      {PLAN_CONFIG[plan].name}
                    </span>
                    <span className="text-slate-400">
                      {count.toLocaleString()} accounts ·{' '}
                      {formatINR(summary.mrrByPlan[plan])} MRR
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-violet-500"
                      style={{
                        width: `${Math.max(share, count > 0 ? 2 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="border-b border-slate-800 p-4">
          <h3 className="text-sm font-bold text-white">
            Recent Subscription Events
          </h3>
        </div>
        {recentEvents.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No subscription events yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Plan Change</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((event) => (
                  <tr
                    key={event.id}
                    className="border-b border-slate-800/60 last:border-0"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-slate-400">
                      {format(new Date(event.created_at), 'd MMM yyyy, HH:mm')}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {event.account_name || 'Personal Account'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                          EVENT_BADGE_CLASSES[event.event_type] ??
                          'bg-slate-500/10 text-slate-400'
                        }`}
                      >
                        {EVENT_LABELS[event.event_type] ?? event.event_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-400">
                      {event.from_plan || event.to_plan
                        ? `${planName(event.from_plan)} → ${planName(event.to_plan)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
