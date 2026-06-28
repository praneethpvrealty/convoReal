import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  verifyPhoneNumber,
  registerPhoneNumber,
  subscribeWabaToApp,
  sendTemplateMessage,
} from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { getSandboxSystemConfig } from '@/lib/system-settings'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

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

    // Resolve account
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      )
    }

    // Load current config
    const { data: currentConfig } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (!currentConfig) {
      return NextResponse.json(
        { error: 'No WhatsApp configuration found. Please save sandbox first.' },
        { status: 400 }
      )
    }

    if (currentConfig.integration_type !== 'sandbox') {
      return NextResponse.json(
        { error: 'Migration is only available from Sandbox mode.' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const {
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      pin,
      catalog_id,
      auto_sync_catalog,
      notify_leads,
    } = body

    // Validate required fields
    if (!phone_number_id?.trim() || !access_token?.trim()) {
      return NextResponse.json(
        { error: 'Phone Number ID and Access Token are required for Official API.' },
        { status: 400 }
      )
    }

    // Check if another account already uses this phone_number_id
    const { data: claimed } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phone_number_id.trim())
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimed) {
      return NextResponse.json(
        {
          error: 'This WhatsApp phone number is already linked to another account.',
        },
        { status: 409 }
      )
    }

    // Verify credentials with Meta
    let phoneInfo = null
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id.trim(),
        accessToken: access_token.trim(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      return NextResponse.json(
        { error: `Meta API verification failed: ${message}` },
        { status: 400 }
      )
    }

    // Encrypt tokens
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null = null
    try {
      encryptedAccessToken = encrypt(access_token.trim())
      if (verify_token?.trim()) {
        encryptedVerifyToken = encrypt(verify_token.trim())
      }
    } catch {
      return NextResponse.json(
        { error: 'Failed to encrypt token. Check ENCRYPTION_KEY.' },
        { status: 500 }
      )
    }

    // Register with Meta if PIN provided
    let registeredAt: string | null = null
    let registrationError: string | null = null
    let subscribedAppsAt: string | null = null

    const hasPin = typeof pin === 'string' && pin.length > 0
    if (hasPin) {
      try {
        const regResult = await registerPhoneNumber({
          phoneNumberId: phone_number_id.trim(),
          accessToken: access_token.trim(),
          pin,
        })
        if (regResult.testNumberSkipped) {
          console.log('[migrate] Test number detected — skipping /register')
        }
        registeredAt = new Date().toISOString()
      } catch (err) {
        registrationError = err instanceof Error ? err.message : 'Registration failed'
      }
    }

    if (waba_id?.trim()) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id.trim(),
          accessToken: access_token.trim(),
        })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[migrate] WABA subscribed_apps failed (non-fatal):', message)
      }
    }

    // Store old sandbox code before migration
    const oldSandboxCode = currentConfig.sandbox_code

    // Update config to Official API (trigger will record migration timestamp)
    const updatePayload = {
      integration_type: 'official_api',
      phone_number_id: phone_number_id.trim(),
      waba_id: waba_id?.trim() || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registeredAt,
      subscribed_apps_at: subscribedAppsAt,
      last_registration_error: registrationError,
      catalog_id: catalog_id?.trim() || null,
      auto_sync_catalog: typeof auto_sync_catalog === 'boolean' ? auto_sync_catalog : false,
      updated_at: new Date().toISOString(),
    }

    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update(updatePayload)
      .eq('account_id', accountId)

    if (updateError) {
      console.error('Migration update failed:', updateError)
      return NextResponse.json(
        { error: 'Failed to update configuration during migration.' },
        { status: 500 }
      )
    }

    // Optionally notify active leads about the new number
    let notifiedCount = 0
    if (notify_leads && phone_number_id) {
      try {
        const sandboxSystem = await getSandboxSystemConfig()
        if (sandboxSystem.enabled && sandboxSystem.access_token && sandboxSystem.phone_number_id) {
          // Get all active sandbox conversations
          const { data: activeMappings } = await supabaseAdmin()
            .from('sandbox_sender_mappings')
            .select('sender_phone')
            .eq('account_id', accountId)

          if (activeMappings && activeMappings.length > 0) {
            const systemToken = decrypt(sandboxSystem.access_token)
            const systemPhoneId = sandboxSystem.phone_number_id

            for (const mapping of activeMappings.slice(0, 50)) {
              // Limit to 50 to avoid rate limits
              const phone = normalizePhone((mapping as { sender_phone: string }).sender_phone)
              try {
                await sendTemplateMessage({
                  phoneNumberId: systemPhoneId,
                  accessToken: systemToken,
                  to: phone,
                  templateName: 'sandbox_general_reply',
                  language: 'en',
                  params: [
                    'there',
                    `We have upgraded our WhatsApp number. Please save our new number for future messages.`,
                  ],
                })
                notifiedCount++
              } catch (err) {
                console.warn(`[migrate] Failed to notify ${phone}:`, err)
              }
            }
          }
        }
      } catch (err) {
        console.error('[migrate] Lead notification failed:', err)
      }
    }

    return NextResponse.json({
      success: true,
      migrated: true,
      phone_info: phoneInfo,
      registered: !!registeredAt,
      registration_error: registrationError,
      old_sandbox_code: oldSandboxCode,
      leads_notified: notifiedCount,
      message: registrationError
        ? `Saved Official API credentials, but Meta registration failed: ${registrationError}. Please check your PIN and retry.`
        : `Successfully migrated to Official API. Your conversations and contacts are preserved.`,
    })
  } catch (error) {
    console.error('Error in migration POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
