import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

// Mark notifications read. Body `{ ids: string[] }` marks those rows;
// an empty/absent `ids` marks the caller's whole feed read. RLS +
// the user_id filter keep this to the caller's own rows.
export async function POST(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount()
    const body = (await request.json().catch(() => ({}))) as { ids?: string[] }

    let query = ctx.supabase
      .from('notifications')
      // Marking as read is idempotent and filtered to unread rows, so
      // zero rows means there was nothing left to mark.
      // eslint-disable-next-line convoreal/supabase-write-guard
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', ctx.userId)
      .is('read_at', null)

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      query = query.in('id', body.ids)
    }

    const { error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
