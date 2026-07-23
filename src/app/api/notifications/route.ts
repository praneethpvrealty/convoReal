import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

// The caller's own notification feed for the dashboard bell. RLS on
// `notifications` already scopes to user_id = auth.uid(); the explicit
// filter is defence in depth.
export async function GET(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount()
    const url = new URL(request.url)
    const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100)

    const [list, unread] = await Promise.all([
      ctx.supabase
        .from('notifications')
        .select('id, type, title, body, entity_type, entity_id, link, read_at, created_at')
        .eq('user_id', ctx.userId)
        .order('created_at', { ascending: false })
        .limit(limit),
      ctx.supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', ctx.userId)
        .is('read_at', null),
    ])

    if (list.error) {
      return NextResponse.json({ error: list.error.message }, { status: 500 })
    }

    return NextResponse.json({ data: list.data, unreadCount: unread.count ?? 0 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
