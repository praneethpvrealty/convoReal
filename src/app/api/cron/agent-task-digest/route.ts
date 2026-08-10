import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { sendAgentTaskDigests } from '@/lib/agents/task-digest'

/**
 * Agent task digest cron — sends each agent their own open work
 * (overdue tasks, today's tasks, today's calendar) at the times they
 * chose, defaulting to 07:00 / 13:00 / 21:00 IST.
 *
 * Registered every 30 minutes rather than at the default times
 * themselves, because the times are per-agent and configurable: the
 * schedule cannot be expressed in one cron expression once an agent
 * can move a slot to 08:30. Each run asks which of that agent's slots
 * have passed today without a ledger row, so half-hourly is the
 * resolution an agent can schedule to, and a run missed by a platform
 * outage catches up on the next one instead of losing the slot.
 *
 * Safe to ping more often: agent_task_digest_log is an insert-as-claim
 * ledger with a unique constraint per (agent, day, slot), so a rerun
 * inside the same slot sends nothing.
 *
 * Auth: same constant-time shared-secret check as the other digests —
 * `x-cron-secret` header OR Vercel Cron's `Authorization: Bearer`,
 * matched against AUTOMATION_CRON_SECRET or CRON_SECRET. Fails CLOSED
 * (503) when no secret is configured.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sendAgentTaskDigests()
    console.log('[agent-task-digest]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[agent-task-digest] run failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
