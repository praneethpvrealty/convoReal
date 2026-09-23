import type { SupabaseClient } from '@supabase/supabase-js'
import { withContactConversationLease } from '@/lib/conversations/outbound-lease'
import { resolveFallbackPolicy } from './fallback'

export interface FlowSweepResult {
  swept: number
  deferred: number
}

interface ActiveRunRow {
  id: string
  account_id: string
  contact_id: string | null
  last_advanced_at: string
  flows: { fallback_policy: unknown } | { fallback_policy: unknown }[] | null
}

export async function sweepStaleFlowRuns(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<FlowSweepResult> {
  const { data: runs, error } = await admin
    .from('flow_runs')
    .select('id, account_id, contact_id, last_advanced_at, flows ( fallback_policy )')
    .eq('status', 'active')
  if (error) throw error

  const result: FlowSweepResult = { swept: 0, deferred: 0 }
  for (const r of (runs ?? []) as ActiveRunRow[]) {
    const flowsField = Array.isArray(r.flows) ? r.flows[0] : r.flows
    const policy = resolveFallbackPolicy(flowsField?.fallback_policy ?? null)
    const ageHours =
      (now.getTime() - new Date(r.last_advanced_at).getTime()) / (1000 * 60 * 60)
    if (ageHours < policy.on_timeout_hours) continue

    const timeOut = async (): Promise<boolean> => {
      const { data: updated, error: updateError } = await admin
        .from('flow_runs')
        .update({
          status: 'timed_out',
          ended_at: now.toISOString(),
          end_reason: 'stale_sweep',
        })
        .eq('id', r.id)
        .eq('account_id', r.account_id)
        .eq('status', 'active')
        .eq('last_advanced_at', r.last_advanced_at)
        .select('id')
      if (updateError) {
        console.error(`[flows-cron] timing out run ${r.id} failed:`, updateError.message)
        return false
      }
      if (!Array.isArray(updated) || updated.length === 0) return false
      await admin.from('flow_run_events').insert({
        flow_run_id: r.id,
        event_type: 'timeout',
        payload: {
          age_hours: Math.round(ageHours * 10) / 10,
          policy_hours: policy.on_timeout_hours,
        },
      })
      return true
    }

    if (!r.contact_id) {
      if (await timeOut()) result.swept += 1
      continue
    }
    const outcome = await withContactConversationLease(
      admin,
      r.account_id,
      r.contact_id,
      timeOut,
      { requireConversation: true },
    )
    if (outcome.status !== 'ran') {
      result.deferred += 1
      continue
    }
    if (outcome.value) result.swept += 1
  }
  return result
}
