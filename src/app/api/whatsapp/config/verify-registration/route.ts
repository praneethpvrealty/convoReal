import { NextResponse } from 'next/server'
import { getCurrentAccount, UnauthorizedError } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  getSubscribedApps,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import {
  assessRegistration,
  fetchPhoneRegistrationState,
} from '@/lib/whatsapp/registration-state'

/**
 * GET /api/whatsapp/config/verify-registration
 *
 * Diagnostic endpoint — confirms the user's saved phone number is
 * actually reachable on Meta's side. Solves the failure mode that
 * surfaced the multi-number bug originally: "UI says Connected but
 * Meta isn't delivering events."
 *
 * Three checks run independently so the UI can show which step
 * passes and which fails:
 *
 *   1. phone_info  — GET /{phone_number_id} succeeds
 *   2. waba_subscription — our app appears in
 *                    GET /{waba_id}/subscribed_apps
 *   3. registered_at — local timestamp set by POST /config when
 *                    /register last succeeded; NULL means the
 *                    number was saved but never actually subscribed
 *
 * Returns 200 in every case so the UI can render diagnostic detail
 * rather than a generic error toast. The combined `live` flag is
 * what the UI badges on.
 */
export async function GET() {
  // whatsapp_config is one-row-per-account post-017. Resolve the
  // caller's account_id so a teammate who joined an existing account
  // sees the same registration state as the admin who set it up.
  //
  // This is a read-only status probe the settings badge polls, so a
  // caller without a usable account gets the soft `live: false` shape
  // rather than an error the UI would have to special-case. Only a
  // missing session is a hard 401.
  let supabase: Awaited<ReturnType<typeof getCurrentAccount>>['supabase']
  let accountId: string
  try {
    ;({ supabase, accountId } = await getCurrentAccount())
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({
      live: false,
      checks: { config_exists: false },
      message: error instanceof Error ? error.message : 'Account unavailable.',
    })
  }

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!config) {
    return NextResponse.json({
      live: false,
      checks: { config_exists: false },
      message: 'No WhatsApp configuration saved yet.',
    })
  }

  let accessToken: string
  try {
    accessToken = decrypt(config.access_token)
  } catch {
    return NextResponse.json({
      live: false,
      checks: {
        config_exists: true,
        token_decryptable: false,
      },
      message:
        'Stored access token can\'t be decrypted — likely ENCRYPTION_KEY changed. Re-enter the token to repair.',
    })
  }

  const checks: {
    config_exists: boolean
    token_decryptable: boolean
    phone_metadata_ok: boolean
    registered_on_meta: boolean | null
    display_name_approved: boolean | null
    waba_subscribed_to_app: boolean | null
    locally_marked_registered: boolean
  } = {
    config_exists: true,
    token_decryptable: true,
    phone_metadata_ok: false,
    registered_on_meta: null,
    display_name_approved: null,
    waba_subscribed_to_app: null,
    locally_marked_registered: config.registered_at != null,
  }
  const errors: string[] = []
  let registeredAt: string | null = config.registered_at ?? null
  let lastRegistrationError: string | null = config.last_registration_error ?? null

  // 1. Phone metadata
  try {
    await verifyPhoneNumber({
      phoneNumberId: config.phone_number_id,
      accessToken,
    })
    checks.phone_metadata_ok = true
  } catch (err) {
    errors.push(
      `Phone metadata check failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 1b. Meta's own registration state. platform_type is CLOUD_API only
  //     once /register has succeeded; before that the number has no
  //     WhatsApp account at all, whatever the local row says.
  const assessment = assessRegistration(
    await fetchPhoneRegistrationState({
      phoneNumberId: config.phone_number_id,
      accessToken,
    }),
  )
  if (assessment) {
    checks.registered_on_meta = assessment.registered
    checks.display_name_approved = assessment.nameApproved
    if (!assessment.registered) {
      errors.push(assessment.reason ?? 'Meta reports this number is not registered.')
      registeredAt = null
      lastRegistrationError = assessment.reason
    } else if (assessment.nameApproved === false) {
      errors.push(
        'The display name is not approved. Messaging may be limited until a name is approved in WhatsApp Manager.',
      )
    }
    const drifted =
      (assessment.registered && config.registered_at == null) ||
      (!assessment.registered && config.registered_at != null)
    if (drifted) {
      if (assessment.registered) registeredAt = new Date().toISOString()
      const { data: fixedConfig } = await supabase
        .from('whatsapp_config')
        .update({
          registered_at: registeredAt,
          last_registration_error: lastRegistrationError,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId)
        .select('id')
      if (!fixedConfig?.length) {
        errors.push(
          'Could not update the stored registration state — an admin needs to run this check.',
        )
      } else {
        checks.locally_marked_registered = registeredAt != null
        await supabase
          .from('whatsapp_number_profiles')
          .update({
            registered_at: registeredAt,
            last_registration_error: lastRegistrationError,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId)
          .eq('phone_number_id', config.phone_number_id)
          .select('id')
      }
    }
  }

  // 2. WABA subscription — only meaningful if we have a waba_id
  if (config.waba_id) {
    try {
      const subs = await getSubscribedApps({
        wabaId: config.waba_id,
        accessToken,
      })
      // Meta returns the apps subscribed to this WABA. If the list
      // is non-empty, OUR app is in there (the access_token we used
      // belongs to our app — Meta wouldn't return data for an app
      // the token can't see). Treat any entry as success.
      checks.waba_subscribed_to_app = subs.length > 0
      if (!checks.waba_subscribed_to_app) {
        errors.push(
          'WABA has no subscribed apps. Re-save the configuration to subscribe.',
        )
      }
    } catch (err) {
      errors.push(
        `WABA subscription check failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  } else {
    errors.push(
      'No WABA ID on file — webhooks can\'t be wired without it. Add it in the form and re-save.',
    )
  }

  const live =
    checks.phone_metadata_ok &&
    (checks.waba_subscribed_to_app ?? false) &&
    checks.locally_marked_registered &&
    checks.registered_on_meta !== false

  return NextResponse.json({
    live,
    checks,
    errors,
    last_registration_error: lastRegistrationError,
    registered_at: registeredAt,
    subscribed_apps_at: config.subscribed_apps_at ?? null,
  })
}
