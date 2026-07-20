import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { sendAgentInventoryDigests } from '@/lib/agents/inventory-digest'

/**
 * Agent inventory digest cron — messages each SOURCE AGENT (the partner
 * agent whose inventory this account lists as agent-referred) on
 * WhatsApp with how far their inventory travelled: direct buyers it was
 * shared with, indirect buyers reached through downstream partner
 * agents (source_property_id lineage), and partner agents onboarded.
 * Source agents without a ConvoReal profile get a signup invite line;
 * signed-up agents get a dashboard pointer instead.
 *
 * Sends ONLY when the period added new buyers, dedups per IST day via
 * agent_inventory_digest_log, and respects the per-contact
 * "STOP UPDATES" opt-out. Registered in vercel.json (daily, 04:45 UTC
 * = 10:15 IST — inside the engine's IST morning send window). Safe to
 * ping more often: the insert-as-claim ledger makes reruns no-ops.
 *
 * Auth: same constant-time shared-secret check as owner-digest —
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
    const result = await sendAgentInventoryDigests()
    console.log('[agent-inventory-digest]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[agent-inventory-digest] run failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
