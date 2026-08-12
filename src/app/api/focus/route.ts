import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadFocusSnapshot } from '@/lib/focus/queries'

// GET /api/focus
// The consultant's landing view: today's tasks and visits, the three
// journeys that most need attention, and the three inbound requests
// waiting on an answer. Both the web tab and the mobile screen read
// this route, so the ranking cannot drift between them.
export async function GET() {
  try {
    const ctx = await requireRole('viewer')
    const data = await loadFocusSnapshot(ctx.supabase, ctx.accountId)
    return NextResponse.json({ data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
