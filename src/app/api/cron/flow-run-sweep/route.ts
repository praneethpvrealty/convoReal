import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sweepStaleFlowRuns } from '@/lib/flows/sweep'

/**
 * Sweep abandoned active flow runs.
 *
 * Reads each active run's parent-flow `fallback_policy.on_timeout_hours`
 * to compute the staleness cutoff (default 24h), then marks any run
 * past its cutoff as `timed_out`. Writes a matching `flow_run_events`
 * row for the audit trail.
 *
 * Without this sweep, a customer who abandons a flow mid-conversation
 * keeps a row in `idx_one_active_run_per_contact` (the partial unique
 * index on `flow_runs WHERE status='active'`) forever — blocking any
 * new triggers for them. The cron is therefore not optional.
 *
 * Auth: same constant-time shared-secret check as the other crons —
 * `x-cron-secret` header OR Vercel Cron's `Authorization: Bearer`,
 * matched against AUTOMATION_CRON_SECRET or CRON_SECRET. Fails CLOSED
 * (503) when no secret is configured.
 *
 * Registered in vercel.json (hourly at :40); runs at 24h-scale
 * timeouts need nothing tighter. It lives under /api/cron/ because the
 * Cloudflare pre-launch rule challenges non-Indian traffic everywhere
 * else (docs/cloudflare-waf.md), and Vercel Cron calls from the US.
 * /api/flows/cron re-exports this handler for existing callers.
 */
export async function GET(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await sweepStaleFlowRuns(supabaseAdmin()))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[flows-cron] active-run scan failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
