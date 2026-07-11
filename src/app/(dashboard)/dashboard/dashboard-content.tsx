"use client"

import { useCallback, useEffect, useState } from 'react'
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
import type {
  ActivityItem,
  AgentLoadEntry,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { ActiveUsers } from '@/components/dashboard/active-users'
import { TeamWorkload } from '@/components/dashboard/team-workload'
import { getCurrencyIcon, formatCurrency } from '@/lib/currency-utils'
import { useAuth } from '@/hooks/use-auth'

type RangeDays = 7 | 30 | 90

export default function DashboardContent() {
  const { isOrgManager, isOrgLeader } = useAuth()
  const showWorkload = isOrgManager || isOrgLeader

  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [currency, setCurrency] = useState('INR')

  const [unassignedCount, setUnassignedCount] = useState(0)
  const [agentLoad, setAgentLoad] = useState<AgentLoadEntry[]>([])
  const [workloadLoading, setWorkloadLoading] = useState(true)

  useEffect(() => {
    const db = createClient()
    db.from('showcase_settings')
      .select('currency')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.currency) {
          setCurrency(data.currency)
        }
      })
  }, [])

  const [range, setRange] = useState<RangeDays>(30)
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    void loadMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))

    if (showWorkload) {
      void Promise.all([loadUnassignedQueueDepth(db), loadAgentLoad(db)])
        .then(([count, load]) => {
          setUnassignedCount(count)
          setAgentLoad(load)
        })
        .catch((err) => console.error('[dashboard] workload failed:', err))
        .finally(() => setWorkloadLoading(false))
    } else {
      void Promise.resolve().then(() => setWorkloadLoading(false))
    }
  }, [showWorkload])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series],
  )

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
              hint="Contacts added to your CRM today — from incoming messages or manual creation."
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
              series={series}
              loading={seriesLoading}
              range={range}
              onRangeChange={handleRangeChange}
            />
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <PipelineDonut data={pipeline} loading={pipelineLoading} currency={currency} />
            <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />
          </div>
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
