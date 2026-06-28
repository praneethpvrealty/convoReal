import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
  checkWhatsAppPermissions,
} from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/**
 * Resolve the caller's account_id from their profile. Inlined here
 * (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// Lazy-initialised service-role client. We need it to detect a
// phone_number_id already claimed by a *different* user — under RLS,
// the user's own session can't see other users' rows, so the conflict
// would be invisible without the service role.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token, status, catalog_id, auto_sync_catalog, integration_type, sandbox_code, trial_ends_at, sandbox_message_count, sandbox_message_limit')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    const intType = config.integration_type || 'official_api'

    // Try to decrypt the stored token with the current ENCRYPTION_KEY if it's Official API.
    if (intType === 'official_api' && config.access_token) {
      try {
        decrypt(config.access_token)
      } catch (err) {
        console.error('[whatsapp/config GET] Token decryption failed:', err)
        return NextResponse.json(
          {
            connected: false,
            reason: 'token_corrupted',
            needs_reset: true,
            message:
              'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
          },
          { status: 200 }
        )
      }
    }

    // Load sandbox system details if tenant is in sandbox mode
    let sandboxSystemPhone: string | null = null
    if (intType === 'sandbox') {
      const { data: sandboxSetting } = await supabaseAdmin()
        .from('system_settings')
        .select('value')
        .eq('key', 'sandbox_config')
        .maybeSingle()
      const sandboxCfg = (sandboxSetting as unknown as { value?: Record<string, unknown> })?.value
      if (sandboxCfg?.enabled && sandboxCfg?.phone_number_id) {
        sandboxSystemPhone = sandboxCfg.phone_number_id as string
      }
    }

    // Return stored configuration
    return NextResponse.json({
      connected: config.status === 'connected',
      phone_number_id: config.phone_number_id,
      catalog_id: config.catalog_id || null,
      auto_sync_catalog: config.auto_sync_catalog || false,
      integration_type: intType,
      sandbox_code: config.sandbox_code || null,
      trial_ends_at: config.trial_ends_at || null,
      sandbox_message_count: config.sandbox_message_count || 0,
      sandbox_message_limit: config.sandbox_message_limit || 50,
      sandbox_system_phone: sandboxSystemPhone,
    })
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { phone_number_id, waba_id, access_token, verify_token, pin, catalog_id, auto_sync_catalog, integration_type } = body

    const intType = integration_type || 'official_api'

    if (intType === 'official_api' && (!access_token || !phone_number_id)) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required for Official API' },
        { status: 400 }
      )
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        )
      }
    }

    // Look up any pre-existing row for this account so we know whether
    // this number is already registered with Meta — if so we can skip
    // /register when the user didn't provide a PIN this time around.
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, registered_at, phone_number_id')
      .eq('account_id', accountId)
      .maybeSingle()

    let phoneInfo = null
    let encryptedAccessToken = null
    let encryptedVerifyToken = null
    let registeredAt = existing?.registered_at ?? null
    let registrationError = null
    let subscribedAppsAt = null

    if (intType === 'official_api') {
      // Reject if another account has already claimed this phone_number_id.
      const { data: claimed, error: claimedError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('account_id')
        .eq('phone_number_id', phone_number_id)
        .neq('account_id', accountId)
        .maybeSingle()

      if (claimedError) {
        console.error('Error checking phone_number_id ownership:', claimedError)
        return NextResponse.json(
          { error: 'Failed to validate configuration' },
          { status: 500 }
        )
      }

      if (claimed) {
        return NextResponse.json(
          {
            error:
              'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one ConvoReal user.',
          },
          { status: 409 }
        )
      }

      // Verify credentials with Meta BEFORE saving
      try {
        phoneInfo = await verifyPhoneNumber({
          phoneNumberId: phone_number_id,
          accessToken: access_token,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Meta API error'
        console.error('Meta API verification failed during save:', message)
        return NextResponse.json(
          { error: `Meta API error: ${message}` },
          { status: 400 }
        )
      }

      // Check token permissions for media access
      const permissionCheck = await checkWhatsAppPermissions(access_token, waba_id)
      if (permissionCheck.hasIssues) {
        console.warn('WhatsApp permission issues detected:', permissionCheck.issues)
      }

      // Encrypt sensitive tokens before storing
      try {
        encryptedAccessToken = encrypt(access_token)
        encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown encryption error'
        console.error('Encryption failed:', message)
        return NextResponse.json(
          {
            error:
              'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
          },
          { status: 500 }
        )
      }

      const sameNumber =
        existing?.phone_number_id === phone_number_id &&
        existing?.registered_at != null

      const hasPin = typeof pin === 'string' && pin.length > 0
      const needsRegistration = hasPin  // only register when PIN is explicitly provided
      if (needsRegistration) {
        try {
          const regResult = await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          })
          if (regResult.testNumberSkipped) {
            console.log('[whatsapp/config] Test number detected — skipping /register')
          }
          registeredAt = new Date().toISOString()
        } catch (err) {
          registrationError =
            err instanceof Error ? err.message : 'Unknown Meta API error'
          console.error('Phone number /register failed:', registrationError)
        }
      } else if (!sameNumber) {
        console.log('[whatsapp/config] No PIN provided — assuming number already registered.')
        registeredAt = new Date().toISOString()
      }

      if (waba_id) {
        try {
          await subscribeWabaToApp({
            wabaId: waba_id,
            accessToken: access_token,
          })
          subscribedAppsAt = new Date().toISOString()
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.warn('WABA subscribed_apps failed (non-fatal):', message)
        }
      }
    }

    const baseRow = {
      phone_number_id: intType === 'official_api' ? phone_number_id : null,
      waba_id: intType === 'official_api' ? (waba_id || null) : null,
      access_token: intType === 'official_api' ? encryptedAccessToken : null,
      verify_token: intType === 'official_api' ? encryptedVerifyToken : null,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
      catalog_id: intType === 'official_api' ? (catalog_id || null) : null,
      auto_sync_catalog: intType === 'official_api' ? (typeof auto_sync_catalog === 'boolean' ? auto_sync_catalog : false) : false,
      integration_type: intType,
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId)

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        )
      }
    } else {
      // Insert with both columns: `account_id` is the tenancy key
      // (NOT NULL post-017, UNIQUE so duplicates trip the constraint
      // up-front), `user_id` is the audit column identifying which
      // member of the account saved the config.
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          ...baseRow,
        })

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        )
      }
    }

    if (registrationError) {
      // Save succeeded but the number isn't actually live. Return
      // 200 with a structured error so the UI can show the specific
      // remediation step instead of a generic toast.
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        phone_info: phoneInfo,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: true,
      phone_info: phoneInfo,
      catalog_id: catalog_id || null,
      auto_sync_catalog: typeof auto_sync_catalog === 'boolean' ? auto_sync_catalog : false,
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 * Used by the "Reset Configuration" button to recover from a corrupted
 * encrypted token (mismatched ENCRYPTION_KEY across environments).
 */
export async function DELETE() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
