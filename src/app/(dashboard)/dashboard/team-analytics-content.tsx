'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Handshake, Lock, MessageSquare, Timer, UserCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { usePlan } from '@/hooks/usePlan';
import { formatCurrencyShort } from '@/lib/currency-utils';
import {
  formatResponseSeconds,
  loadTeamAnalytics,
  summarizeTeamAnalytics,
  type TeamAnalyticsRow,
} from '@/lib/team-analytics/queries';
import { BarChart } from '@/components/tremor/bar-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Range = 7 | 30 | 90;

const RANGES: Range[] = [7, 30, 90];

const ORG_ROLE_LABELS: Record<string, string> = {
  org_manager: 'Manager',
  org_leader: 'Leader',
  org_agent: 'Agent',
};

function agentLabel(row: TeamAnalyticsRow) {
  return row.full_name || 'Unnamed member';
}

export default function TeamAnalyticsContent() {
  const db = createClient();
  const { accountId, isOrgManager, isOrgLeader } = useAuth();
  const { isAllowed, isLoading: planLoading, upgradeUrl } = usePlan();
  const [range, setRange] = useState<Range>(30);

  const planAllowed = isAllowed('teams');
  const canView = isOrgManager || isOrgLeader;

  const analyticsQuery = useQuery({
    queryKey: ['team-analytics', accountId, range],
    queryFn: () => loadTeamAnalytics(db, accountId!, range),
    enabled: !!accountId && planAllowed && canView,
  });

  if (!planLoading && !planAllowed) {
    return (
      <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Lock className="h-8 w-8 text-slate-500" />
          <h3 className="text-lg font-bold text-white">
            Team Analytics is a Team plan feature
          </h3>
          <p className="max-w-md text-sm text-slate-400">
            Upgrade to the Team plan for team analytics, or the Agency plan for
            org-wide analytics across every team.
          </p>
          <Link href={upgradeUrl} className={cn(buttonVariants(), 'mt-2')}>
            View plans
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!canView) {
    return (
      <p className="py-16 text-center text-sm text-slate-500">
        Team analytics is available to org managers and team leaders.
      </p>
    );
  }

  if (analyticsQuery.isLoading || planLoading) {
    return (
      <p className="py-16 text-center text-sm text-slate-500">
        Loading team analytics...
      </p>
    );
  }

  if (analyticsQuery.isError) {
    return (
      <p className="py-16 text-center text-sm text-red-400">
        Failed to load team analytics. Ensure the team_analytics database
        function is deployed (migration 180).
      </p>
    );
  }

  const rows = analyticsQuery.data ?? [];
  const summary = summarizeTeamAnalytics(rows);

  const messagesData = rows
    .filter((r) => r.messages_sent > 0)
    .slice(0, 8)
    .map((r) => ({ agent: agentLabel(r), Messages: r.messages_sent }));

  const wonData = rows
    .filter((r) => Number(r.deals_won_value) > 0)
    .sort((a, b) => Number(b.deals_won_value) - Number(a.deals_won_value))
    .slice(0, 8)
    .map((r) => ({
      agent: agentLabel(r),
      'Won value': Number(r.deals_won_value),
    }));

  const responseData = rows
    .filter((r) => r.median_response_seconds != null)
    .sort(
      (a, b) =>
        Number(a.median_response_seconds) - Number(b.median_response_seconds)
    )
    .slice(0, 8)
    .map((r) => ({
      agent: agentLabel(r),
      'Median response (min)':
        Math.round((Number(r.median_response_seconds) / 60) * 10) / 10,
    }));

  const tiles = [
    {
      title: 'Messages Sent',
      value: summary.messagesSent.toLocaleString(),
      sub: `by ${summary.agents} member${summary.agents === 1 ? '' : 's'}`,
      icon: MessageSquare,
    },
    {
      title: 'Conversations Closed',
      value: summary.conversationsClosed.toLocaleString(),
      sub: `${summary.openConversations.toLocaleString()} currently open`,
      icon: UserCheck,
    },
    {
      title: 'Deals Won',
      value: summary.dealsWon.toLocaleString(),
      sub: formatCurrencyShort(summary.dealsWonValue),
      icon: Handshake,
    },
    {
      title: 'Avg First Response',
      value: formatResponseSeconds(summary.avgResponseSeconds),
      sub: `${summary.responseSamples.toLocaleString()} replies measured`,
      icon: Timer,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          {isOrgManager ? 'Org-wide performance' : 'Your team’s performance'}{' '}
          over the selected period.
        </p>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                range === r
                  ? 'bg-primary/20 text-primary'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">
            Messages by Member
          </h3>
          {messagesData.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No messages in this period.
            </p>
          ) : (
            <BarChart
              data={messagesData}
              index="agent"
              categories={['Messages']}
              colors={['violet']}
              valueFormatter={(value) => value.toLocaleString()}
              showLegend={false}
              layout="vertical"
              yAxisWidth={110}
              className="h-[240px]"
            />
          )}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">
            Won Value by Member
          </h3>
          {wonData.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No deals won in this period.
            </p>
          ) : (
            <BarChart
              data={wonData}
              index="agent"
              categories={['Won value']}
              colors={['emerald']}
              valueFormatter={(value) => formatCurrencyShort(value)}
              showLegend={false}
              layout="vertical"
              yAxisWidth={110}
              className="h-[240px]"
            />
          )}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">
            Median Response by Member
          </h3>
          {responseData.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No measured replies in this period.
            </p>
          ) : (
            <BarChart
              data={responseData}
              index="agent"
              categories={['Median response (min)']}
              colors={['blue']}
              valueFormatter={(value) => `${value.toLocaleString()}m`}
              showLegend={false}
              layout="vertical"
              yAxisWidth={110}
              className="h-[240px]"
            />
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="border-b border-slate-800 p-4">
          <h3 className="text-sm font-bold text-white">Member Leaderboard</h3>
        </div>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No team members found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Team</th>
                  <th className="px-4 py-3 text-right">Open</th>
                  <th className="px-4 py-3 text-right">Closed</th>
                  <th className="px-4 py-3 text-right">Messages</th>
                  <th className="px-4 py-3 text-right">Deals Won</th>
                  <th className="px-4 py-3 text-right">Won Value</th>
                  <th className="px-4 py-3 text-right">Median Response</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.user_id}
                    className="border-b border-slate-800/60 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-200">
                        {agentLabel(row)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {ORG_ROLE_LABELS[row.org_role ?? ''] ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {row.team_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.open_conversations.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.conversations_closed.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.messages_sent.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.deals_won.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {formatCurrencyShort(Number(row.deals_won_value))}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {formatResponseSeconds(
                        row.median_response_seconds == null
                          ? null
                          : Number(row.median_response_seconds)
                      )}
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
