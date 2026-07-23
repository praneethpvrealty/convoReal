import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

// The Expo mobile app registers its push token here after login. Upsert
// on (user_id, expo_push_token) so re-registering the same device is
// idempotent and refreshes updated_at. RLS ensures the row is the
// caller's own.
export async function POST(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount()
    const body = (await request.json().catch(() => ({}))) as { token?: string; platform?: string }
    const token = typeof body.token === 'string' ? body.token.trim() : ''

    if (!token.startsWith('ExponentPushToken')) {
      return NextResponse.json({ error: 'A valid Expo push token is required' }, { status: 400 })
    }

    const { error } = await ctx.supabase
      .from('notification_devices')
      .upsert(
        {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          expo_push_token: token,
          platform: typeof body.platform === 'string' ? body.platform.slice(0, 20) : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,expo_push_token' }
      )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
