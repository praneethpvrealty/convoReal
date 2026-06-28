import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

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

async function checkAdminAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { authorized: false, status: 401, error: 'Unauthorized' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (profile?.role !== 'super_admin') {
    return { authorized: false, status: 403, error: 'Forbidden' }
  }

  return { authorized: true, userId: user.id }
}

/**
 * GET /api/admin/sandbox-tenants
 *
 * List all sandbox tenants with their usage stats.
 * Protected by super_admin role.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await checkAdminAuth(supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const url = new URL(request.url)
    const includeExpired = url.searchParams.get('include_expired') === 'true'

    let query = supabaseAdmin()
      .from('whatsapp_config')
      .select('*, owner:profiles(full_name, email, user_id)')
      .eq('integration_type', 'sandbox')

    if (!includeExpired) {
      query = query.or(`trial_ends_at.gt.${new Date().toISOString()},trial_ends_at.is.null`)
    }

    const { data: configs, error } = await query

    if (error) {
      console.error('Error fetching sandbox tenants:', error)
      return NextResponse.json({ error: 'Failed to fetch tenants' }, { status: 500 })
    }

    // Enrich with conversation counts
    const enriched = await Promise.all(
      (configs || []).map(async (cfg: Record<string, unknown>) => {
        const accountId = cfg.account_id as string

        const { count: convCount } = await supabaseAdmin()
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId)

        const { count: msgCount } = await supabaseAdmin()
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId)

        const { count: contactCount } = await supabaseAdmin()
          .from('contacts')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId)

        return {
          ...cfg,
          stats: {
            conversations: convCount || 0,
            messages: msgCount || 0,
            contacts: contactCount || 0,
          },
        } as Record<string, unknown>
      })
    )

    return NextResponse.json({ tenants: enriched })
  } catch (error) {
    console.error('Error in GET sandbox-tenants:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/sandbox-tenants/migrate
 *
 * Bulk or individual migration from sandbox to official API.
 * Admin provides credentials that will be applied to selected tenants.
 * In real usage, each tenant should migrate themselves. This is for admin override.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await checkAdminAuth(supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await request.json()
    const {
      tenant_account_ids,
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      pin,
    } = body

    if (!Array.isArray(tenant_account_ids) || tenant_account_ids.length === 0) {
      return NextResponse.json({ error: 'tenant_account_ids array required' }, { status: 400 })
    }

    if (!phone_number_id?.trim() || !access_token?.trim()) {
      return NextResponse.json(
        { error: 'phone_number_id and access_token required for migration' },
        { status: 400 }
      )
    }

    // Verify credentials with Meta once
    try {
      await verifyPhoneNumber({
        phoneNumberId: phone_number_id.trim(),
        accessToken: access_token.trim(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Meta API verification failed'
      return NextResponse.json({ error: `Invalid credentials: ${message}` }, { status: 400 })
    }

    const encryptedToken = encrypt(access_token.trim())
    const encryptedVerify = verify_token?.trim() ? encrypt(verify_token.trim()) : null

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [] as string[],
    }

    for (const accountId of tenant_account_ids) {
      results.processed++

      try {
        const { data: existing } = await supabaseAdmin()
          .from('whatsapp_config')
          .select('id, integration_type')
          .eq('account_id', accountId)
          .maybeSingle()

        if (!existing) {
          results.failed++
          results.errors.push(`Account ${accountId}: no config found`)
          continue
        }

        if ((existing as unknown as Record<string, unknown>).integration_type !== 'sandbox') {
          results.failed++
          results.errors.push(`Account ${accountId}: not in sandbox mode`)
          continue
        }

        const updatePayload = {
          integration_type: 'official_api',
          phone_number_id: phone_number_id.trim(),
          waba_id: waba_id?.trim() || null,
          access_token: encryptedToken,
          verify_token: encryptedVerify,
          status: 'connected',
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        const { error: updateError } = await (supabaseAdmin()
          .from('whatsapp_config') as unknown as { update: (data: unknown) => { eq: (col: string, val: string) => Promise<{ error: Error | null }> } })
          .update(updatePayload)
          .eq('account_id', accountId)

        if (updateError) {
          results.failed++
          results.errors.push(`Account ${accountId}: ${updateError.message}`)
        } else {
          results.succeeded++
        }
      } catch (err) {
        results.failed++
        results.errors.push(`Account ${accountId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return NextResponse.json({
      success: results.succeeded > 0,
      ...results,
    })
  } catch (error) {
    console.error('Error in POST sandbox-tenants migrate:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
