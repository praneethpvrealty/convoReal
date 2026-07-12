import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

let _adminClient: ReturnType<typeof createAdminClient> | null = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

async function checkSuperAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { authorized: false, status: 401, error: 'Unauthorized', userId: null }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (profile?.role !== 'super_admin') {
    return { authorized: false, status: 403, error: 'Forbidden', userId: null }
  }

  return { authorized: true, userId: user.id, status: 200, error: null }
}

/**
 * PATCH /api/admin/organizations/[id]
 *
 * Toggle an account's status between 'active' and 'archived'.
 * Body: { action: 'archive' | 'reactivate' }
 * Protected by super_admin role.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const auth = await checkSuperAdmin(supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { id } = await params
    const body = await request.json()
    const { action } = body as { action: 'archive' | 'reactivate' }

    if (!action || !['archive', 'reactivate'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "archive" or "reactivate"' },
        { status: 400 }
      )
    }

    // Verify the account exists
    const { data: existing, error: fetchError } = await supabaseAdmin()
      .from('accounts')
      .select('id, status, name')
      .eq('id', id)
      .maybeSingle()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const newStatus = action === 'archive' ? 'archived' : 'active'
    const now = new Date().toISOString()

    const updatePayload =
      action === 'archive'
        ? { status: newStatus, archived_at: now, archived_by: auth.userId }
        : { status: newStatus, archived_at: null, archived_by: null }

    // The new columns (status, archived_at, archived_by) are not yet in the
    // generated Supabase types because the migration runs at deploy time.
    // Cast via `any` until `supabase gen types` is re-run post-migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminAny = supabaseAdmin() as any
    const { error: updateError } = await adminAny
      .from('accounts')
      .update(updatePayload)
      .eq('id', id)

    if (updateError) {
      console.error('[admin/organizations] update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update account status' },
        { status: 500 }
      )
    }

    const actionLabel = action === 'archive' ? 'archived' : 'reactivated'
    console.log(
      `[admin/organizations] account ${id} (${(existing as Record<string, unknown>).name}) ${actionLabel} by admin ${auth.userId}`
    )

    return NextResponse.json({ success: true, id, status: newStatus })
  } catch (error) {
    console.error('[admin/organizations] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/organizations/[id]
 *
 * Permanently delete an account and all its data via CASCADE.
 * This is IRREVERSIBLE. Requires the account to be archived first as a
 * safety check.
 * Protected by super_admin role.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const auth = await checkSuperAdmin(supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { id } = await params

    // Verify the account exists and is archived (safety gate)
    const { data: existing, error: fetchError } = await supabaseAdmin()
      .from('accounts')
      .select('id, status, name')
      .eq('id', id)
      .maybeSingle()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const accountRow = existing as { id: string; status: string; name: string }

    if (accountRow.status !== 'archived') {
      return NextResponse.json(
        { error: 'Account must be archived before it can be deleted' },
        { status: 422 }
      )
    }

    // Hard delete — all child tables CASCADE
    const { error: deleteError } = await supabaseAdmin()
      .from('accounts')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('[admin/organizations] delete error:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete account' },
        { status: 500 }
      )
    }

    console.log(
      `[admin/organizations] account ${id} (${accountRow.name}) PERMANENTLY DELETED by admin ${auth.userId}`
    )

    // Also delete the Supabase Auth user (the owner) so they cannot re-login
    // after deletion. The profiles row cascades automatically.
    // We find their user id via profiles.
    const { data: ownerProfile } = await supabaseAdmin()
      .from('profiles')
      .select('user_id')
      .eq('account_id', id)
      .eq('account_role', 'owner')
      .maybeSingle()

    const ownerUserId = (ownerProfile as { user_id?: string } | null)?.user_id
    if (ownerUserId) {
      const { error: authDeleteError } =
        await supabaseAdmin().auth.admin.deleteUser(ownerUserId)
      if (authDeleteError) {
        // Non-fatal — account data is gone, auth user cleanup is best-effort
        console.warn(
          `[admin/organizations] failed to delete auth user ${ownerUserId}:`,
          authDeleteError.message
        )
      }
    }

    return NextResponse.json({ success: true, id, deleted: true })
  } catch (error) {
    console.error('[admin/organizations] DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
