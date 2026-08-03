"use client"

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  MessageSquare,
  UserPlus,
  Send,
} from 'lucide-react'

import {
  loadActivity,
  loadAgentLoad,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
  loadUnassignedQueueDepth,
} from '@/lib/dashboard/queries'
import type { AgentLoadEntry } from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { ActiveUsers } from '@/components/dashboard/active-users'
import { TeamWorkload } from '@/components/dashboard/team-workload'
import { NetworkReach } from '@/components/dashboard/network-reach'
import { getCurrencyIcon, formatCurrency } from '@/lib/currency-utils'
import { useAuth } from '@/hooks/use-auth'

type RangeDays = 7 | 30 | 90

export default function DashboardContent() {
  const { isOrgManager, isOrgLeader, accountId } = useAuth()
  const showWorkload = isOrgManager || isOrgLeader

  const [range, setRange] = useState<RangeDays>(30)

  // Every panel is its own query. React Query owns the loading state,
  // dedupes concurrent callers, and keeps results across navigation —
  // previously each panel carried a `useState` pair and every visit to
  // the page refetched all six from scratch.
  const enabled = Boolean(accountId)
  const db = useMemo(() => createClient(), [])

  const currencyQuery = useQuery({
    queryKey: ['dashboard', 'currency'],
    queryFn: async () => {
      const { data } = await db.from('showcase_settings').select('currency').maybeSingle()
      return (data?.currency as string | undefined) ?? 'INR'
    },
    // Account currency effectively never changes within a session.
    staleTime: Infinity,
  })
  const currency = currencyQuery.data ?? 'INR'

  const metricsQuery = useQuery({
    queryKey: ['dashboard', 'metrics', accountId],
    queryFn: () => loadMetrics(db, accountId!),
    enabled,
  })

  // Keyed by range, so switching 30 → 7 → 30 refetches nothing. This
  // replaces a hand-rolled Record<RangeDays, …> memo.
  const seriesQuery = useQuery({
    queryKey: ['dashboard', 'series', accountId, range],
    queryFn: () => loadConversationsSeries(db, range, accountId!),
    enabled,
    placeholderData: (prev) => prev,
  })

  const pipelineQuery = useQuery({
    queryKey: ['dashboard', 'pipeline', accountId],
    queryFn: () => loadPipelineDonut(db, accountId!),
    enabled,
  })

  const responseTimeQuery = useQuery({
    queryKey: ['dashboard', 'response-time', accountId],
    queryFn: () => loadResponseTime(db, accountId!),
    enabled,
  })

  const activityQuery = useQuery({
    queryKey: ['dashboard', 'activity', accountId],
    queryFn: () => loadActivity(db, 50),
    enabled,
  })

  const workloadQuery = useQuery({
    queryKey: ['dashboard', 'workload', accountId],
    queryFn: async () => {
      const [unassigned, load] = await Promise.all([
        loadUnassignedQueueDepth(db),
        loadAgentLoad(db),
      ])
      return { unassigned, load }
    },
    enabled: enabled && showWorkload,
  })

  const metrics = metricsQuery.data ?? null
  const metricsLoading = metricsQuery.isPending
  const pipeline = pipelineQuery.data ?? null
  const pipelineLoading = pipelineQuery.isPending
  const responseTime = responseTimeQuery.data ?? null
  const responseTimeLoading = responseTimeQuery.isPending
  const activity = activityQuery.data ?? null
  const activityLoading = activityQuery.isPending
  const unassignedCount = workloadQuery.data?.unassigned ?? 0
  const agentLoad: AgentLoadEntry[] = workloadQuery.data?.load ?? []
  const workloadLoading = showWorkload && workloadQuery.isPending

  const handleRangeChange = useCallback((r: RangeDays) => setRange(r), [])

  return (
    <div className="space-y-6 relative overflow-hidden">
      {/* Decorative ambient background glows */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-primary/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/2 -left-40 w-[450px] h-[450px] bg-indigo-500/10 rounded-full blur-[110px] pointer-events-none" />

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 relative z-10">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Active Conversations"
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              highlight={true}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(metrics.activeConversations.previous, 'new today vs yesterday'),
              }}
              hint="Open WhatsApp threads with at least one message in the last 24 hours."
            />
            <MetricCard
              title="New Contacts Today"
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign:
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  'vs yesterday',
                ),
              }}
              hint="Contacts added to your Engine today — from incoming messages or manual creation."
            />
            <MetricCard
              title="Expected Revenue (Brokerage)"
              value={formatCurrency(metrics.openDealsValue, currency)}
              icon={getCurrencyIcon(currency)}
              subtitle={`${metrics.openDealsCount} open deal${metrics.openDealsCount === 1 ? '' : 's'}`}
              hint="Total deal value across all open pipeline stages, representing potential brokerage earnings."
            />
            <MetricCard
              title="Messages Sent Today"
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              delta={{
                sign:
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  'vs yesterday',
                ),
              }}
              hint="WhatsApp messages (template + session) sent by you and your team since midnight."
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <div className="relative z-10">
        <QuickActions />
      </div>

      {/* Main Grid Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 relative z-10 items-start">
        {/* Left Columns (Charts and Performance) */}
        <div className="lg:col-span-9 space-y-6">
          <div className="w-full">
            <ConversationsChart
              data={seriesQuery.data ?? null}
              loading={seriesQuery.isPending}
              range={range}
              onRangeChange={handleRangeChange}
            />
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <PipelineDonut data={pipeline} loading={pipelineLoading} currency={currency} />
            <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />
          </div>
          <NetworkReach />
        </div>

        {/* Right Columns (Active Roster & Activity Feed) */}
        <div className="lg:col-span-3 space-y-6">
          <ActiveUsers />
          {showWorkload && (
            <TeamWorkload
              unassignedCount={unassignedCount}
              agentLoad={agentLoad}
              loading={workloadLoading}
            />
          )}
          <ActivityFeed items={activity} loading={activityLoading} />
        </div>
      </div>
    </div>
  )
}

function deltaLabel(delta: number, suffix: string): string {
  if (delta === 0) return `No change ${suffix}`
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
