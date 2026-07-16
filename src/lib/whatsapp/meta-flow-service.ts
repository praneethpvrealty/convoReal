import crypto from 'node:crypto'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { generateFlowKeyPair } from '@/lib/whatsapp/flow-crypto'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import {
  PREFERENCE_FLOW_KEY,
  PREFERENCE_FLOW_NAME,
  PREFERENCE_FLOW_JSON_VERSION,
  buildPreferenceFlowJson,
  buildPreferencePrefillData,
  preferenceFormToContactUpdate,
  parsePreferenceFormValues,
  type ContactPreferenceUpdate,
  type PreferenceFormValues,
} from '@/lib/whatsapp/preference-flow'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

/** Sessions older than this can no longer complete (kept generous —
 *  Meta itself expires undelivered flows well before this). */
const FLOW_SESSION_TTL_HOURS = 24 * 7

let _adminClient: SupabaseClient | null = null
function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  )
}

/** Public HTTPS URL Meta calls for this tenant's flow data exchanges. */
export function flowsEndpointUri(accountId: string): string {
  return `${appBaseUrl()}/api/whatsapp/flows/endpoint/${accountId}`
}

interface WhatsappConfigRow {
  account_id: string
  user_id: string
  phone_number_id: string | null
  waba_id: string | null
  access_token: string | null
  integration_type: string
  flows_private_key: string | null
  flows_public_key: string | null
  flows_key_registered_at: string | null
}

async function loadOfficialConfig(
  db: SupabaseClient,
  accountId: string
): Promise<WhatsappConfigRow> {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (error || !config) {
    throw new Error('WhatsApp is not configured for this account.')
  }
  const cfg = config as unknown as WhatsappConfigRow
  if (cfg.integration_type !== 'official_api') {
    throw new Error(
      'WhatsApp Flows require the official Meta Cloud API integration (not sandbox/web).'
    )
  }
  if (!cfg.phone_number_id || !cfg.access_token) {
    throw new Error('WhatsApp credentials are incomplete for this account.')
  }
  if (!cfg.waba_id) {
    throw new Error(
      'A WhatsApp Business Account ID (WABA ID) is required to create flows. Add it in Settings → WhatsApp.'
    )
  }
  return cfg
}

// ── Encryption key management ─────────────────────────────────────

/**
 * Ensure the tenant has an RSA keypair and that the public key is
 * registered with Meta (required before the data-exchange endpoint
 * receives traffic). Idempotent — re-registering the same key is safe.
 */
export async function ensureFlowEncryptionKeys(args: {
  accountId: string
  db?: SupabaseClient
}): Promise<{ publicKeyPem: string; registered: boolean }> {
  const db = args.db || supabaseAdmin()
  const cfg = await loadOfficialConfig(db, args.accountId)
  const accessToken = decrypt(cfg.access_token!)

  let publicKeyPem = cfg.flows_public_key
  if (!publicKeyPem || !cfg.flows_private_key) {
    const pair = generateFlowKeyPair()
    publicKeyPem = pair.publicKeyPem
    const { error: updateErr } = await db
      .from('whatsapp_config')
      .update({
        flows_private_key: encrypt(pair.privateKeyPem),
        flows_public_key: pair.publicKeyPem,
        flows_key_registered_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', args.accountId)
    if (updateErr) {
      throw new Error(`Failed to store flow encryption keys: ${updateErr.message}`)
    }
  }

  // Register (or re-register) the public key with Meta.
  const response = await fetch(
    `${META_API_BASE}/${cfg.phone_number_id}/whatsapp_business_encryption`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ business_public_key: publicKeyPem }),
    }
  )
  if (!response.ok) {
    let detail = `${response.status}`
    try {
      const errJson = await response.json()
      detail = errJson?.error?.message || detail
    } catch {
      // non-JSON error body — keep status code
    }
    throw new Error(`Failed to register flows public key with Meta: ${detail}`)
  }

  await db
    .from('whatsapp_config')
    .update({
      flows_key_registered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', args.accountId)

  return { publicKeyPem, registered: true }
}

// ── Flow lifecycle on Meta ────────────────────────────────────────

export interface MetaFlowRow {
  id: string
  account_id: string
  flow_key: string
  meta_flow_id: string | null
  name: string
  status: 'draft' | 'published' | 'deprecated' | 'error'
  flow_json_version: string | null
  last_synced_at: string | null
  last_error: string | null
}

/**
 * Create (if needed), upload the latest Flow JSON, and publish the
 * Buyer Preference Intake flow for an account. Also makes sure the
 * encryption keys are registered, since the flow is endpoint-backed.
 *
 * Safe to call repeatedly — it updates the JSON asset in place and
 * republishing an unchanged published flow is skipped by Meta.
 */
export async function setupPreferenceFlow(args: {
  accountId: string
  db?: SupabaseClient
}): Promise<MetaFlowRow> {
  const db = args.db || supabaseAdmin()
  const { accountId } = args
  const cfg = await loadOfficialConfig(db, accountId)
  const accessToken = decrypt(cfg.access_token!)

  await ensureFlowEncryptionKeys({ accountId, db })

  // Load or create the registry row.
  const { data: existingRow } = await db
    .from('whatsapp_meta_flows')
    .select('*')
    .eq('account_id', accountId)
    .eq('flow_key', PREFERENCE_FLOW_KEY)
    .maybeSingle()

  let row = existingRow as MetaFlowRow | null
  if (!row) {
    const { data: inserted, error: insertErr } = await db
      .from('whatsapp_meta_flows')
      .insert({
        account_id: accountId,
        flow_key: PREFERENCE_FLOW_KEY,
        name: PREFERENCE_FLOW_NAME,
        status: 'draft',
        flow_json_version: PREFERENCE_FLOW_JSON_VERSION,
      })
      .select()
      .single()
    if (insertErr || !inserted) {
      throw new Error(`Failed to create flow registry row: ${insertErr?.message}`)
    }
    row = inserted as MetaFlowRow
  }

  const recordError = async (message: string): Promise<never> => {
    await db
      .from('whatsapp_meta_flows')
      .update({ status: 'error', last_error: message.slice(0, 2000) })
      .eq('id', row!.id)
    throw new Error(message)
  }

  const metaFetch = async (path: string, init: RequestInit, what: string) => {
    const response = await fetch(`${META_API_BASE}/${path}`, init)
    let json: Record<string, unknown> = {}
    try {
      json = await response.json()
    } catch {
      // fall through with empty body
    }
    if (!response.ok) {
      const err = json as { error?: { message?: string } }
      return recordError(
        `${what} failed: ${err.error?.message || `HTTP ${response.status}`}`
      )
    }
    return json
  }

  // 1. Create the flow container on Meta if we don't have one yet.
  let metaFlowId = row.meta_flow_id
  if (!metaFlowId) {
    const created = await metaFetch(
      `${cfg.waba_id}/flows`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: PREFERENCE_FLOW_NAME,
          categories: ['LEAD_GENERATION'],
          endpoint_uri: flowsEndpointUri(accountId),
        }),
      },
      'Creating flow on Meta'
    )
    metaFlowId = String((created as { id?: string }).id || '')
    if (!metaFlowId) {
      return recordError('Meta did not return a flow id on creation.')
    }
    await db
      .from('whatsapp_meta_flows')
      .update({ meta_flow_id: metaFlowId })
      .eq('id', row.id)
  } else {
    // Keep the endpoint URI current (base URL may have changed).
    await metaFetch(
      `${metaFlowId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endpoint_uri: flowsEndpointUri(accountId) }),
      },
      'Updating flow endpoint URI'
    )
  }

  // 2. Upload the Flow JSON asset.
  const flowJson = JSON.stringify(buildPreferenceFlowJson())
  const form = new FormData()
  form.append(
    'file',
    new Blob([flowJson], { type: 'application/json' }),
    'flow.json'
  )
  form.append('name', 'flow.json')
  form.append('asset_type', 'FLOW_JSON')

  const uploadResult = (await metaFetch(
    `${metaFlowId}/assets`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    },
    'Uploading flow JSON'
  )) as {
    validation_errors?: Array<{ error?: string; message?: string; line_start?: number }>
  }

  const validationErrors = (uploadResult.validation_errors || []).filter(Boolean)
  if (validationErrors.length > 0) {
    const details = validationErrors
      .map((e) => e.message || e.error)
      .filter(Boolean)
      .join('; ')
    return recordError(`Flow JSON failed Meta validation: ${details}`)
  }

  // 3. Publish. Meta rejects publishing an already-published flow with
  //    no changes — treat that specific case as success.
  const publishResponse = await fetch(`${META_API_BASE}/${metaFlowId}/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!publishResponse.ok) {
    let message = `HTTP ${publishResponse.status}`
    try {
      const errJson = await publishResponse.json()
      message = errJson?.error?.message || message
    } catch {
      // keep status fallback
    }
    const alreadyPublished = /already published|no changes/i.test(message)
    if (!alreadyPublished) {
      return recordError(`Publishing flow failed: ${message}`)
    }
  }

  const { data: finalRow, error: finalErr } = await db
    .from('whatsapp_meta_flows')
    .update({
      status: 'published',
      flow_json_version: PREFERENCE_FLOW_JSON_VERSION,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', row.id)
    .select()
    .single()
  if (finalErr || !finalRow) {
    throw new Error(`Flow published but registry update failed: ${finalErr?.message}`)
  }
  return finalRow as MetaFlowRow
}

// ── Direct validation against Meta ────────────────────────────────

export interface FlowValidationResult {
  valid: boolean
  errors: Array<{ message: string; line_start?: number }>
}

/**
 * Upload the current Buyer Preference Intake Flow JSON to Meta and
 * report back whatever Meta's own validator says — the same check
 * `setupPreferenceFlow` relies on, without the publish step. Lets a
 * hand-authored assumption about Meta's component rules (see the caps
 * asserted in preference-flow.test.ts) be checked against the real
 * thing instead of drifting silently until a live publish fails.
 *
 * Creates the flow container on Meta if this account doesn't have one
 * yet (mirrors setupPreferenceFlow step 1), but always leaves it in
 * draft — nothing here ever calls /publish, so this is safe to run at
 * any time, including against a flow that's already live.
 */
export async function validatePreferenceFlowJson(args: {
  accountId: string
  db?: SupabaseClient
}): Promise<FlowValidationResult> {
  const db = args.db || supabaseAdmin()
  const { accountId } = args
  const cfg = await loadOfficialConfig(db, accountId)
  const accessToken = decrypt(cfg.access_token!)

  const { data: existingRow } = await db
    .from('whatsapp_meta_flows')
    .select('*')
    .eq('account_id', accountId)
    .eq('flow_key', PREFERENCE_FLOW_KEY)
    .maybeSingle()
  let metaFlowId = (existingRow as MetaFlowRow | null)?.meta_flow_id || null

  const metaFetch = async (path: string, init: RequestInit, what: string) => {
    const response = await fetch(`${META_API_BASE}/${path}`, init)
    let json: Record<string, unknown> = {}
    try {
      json = await response.json()
    } catch {
      // fall through with empty body
    }
    if (!response.ok) {
      const err = json as { error?: { message?: string } }
      throw new Error(`${what} failed: ${err.error?.message || `HTTP ${response.status}`}`)
    }
    return json
  }

  if (!metaFlowId) {
    const created = await metaFetch(
      `${cfg.waba_id}/flows`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: PREFERENCE_FLOW_NAME,
          categories: ['LEAD_GENERATION'],
          endpoint_uri: flowsEndpointUri(accountId),
        }),
      },
      'Creating flow on Meta'
    )
    metaFlowId = String((created as { id?: string }).id || '')
    if (!metaFlowId) {
      throw new Error('Meta did not return a flow id on creation.')
    }
    await db
      .from('whatsapp_meta_flows')
      .upsert(
        {
          account_id: accountId,
          flow_key: PREFERENCE_FLOW_KEY,
          name: PREFERENCE_FLOW_NAME,
          status: 'draft',
          meta_flow_id: metaFlowId,
          flow_json_version: PREFERENCE_FLOW_JSON_VERSION,
        },
        { onConflict: 'account_id,flow_key' }
      )
  }

  const flowJson = JSON.stringify(buildPreferenceFlowJson())
  const form = new FormData()
  form.append('file', new Blob([flowJson], { type: 'application/json' }), 'flow.json')
  form.append('name', 'flow.json')
  form.append('asset_type', 'FLOW_JSON')

  const uploadResult = (await metaFetch(
    `${metaFlowId}/assets`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    },
    'Uploading flow JSON for validation'
  )) as {
    validation_errors?: Array<{ error?: string; message?: string; line_start?: number }>
  }

  const errors = (uploadResult.validation_errors || [])
    .filter(Boolean)
    .map((e) => ({
      message: e.message || e.error || 'Unknown validation error',
      line_start: e.line_start,
    }))

  return { valid: errors.length === 0, errors }
}

// ── Sessions & sending ────────────────────────────────────────────

export interface FlowSessionRow {
  id: string
  account_id: string
  contact_id: string
  flow_key: string
  flow_token: string
  status: 'sent' | 'opened' | 'completed' | 'expired' | 'cancelled'
  response: Record<string, unknown> | null
  expires_at: string | null
  completed_at: string | null
}

/**
 * Look up the published preference flow for an account, or null if the
 * account hasn't set one up yet.
 */
export async function getPublishedPreferenceFlow(
  accountId: string,
  db?: SupabaseClient
): Promise<MetaFlowRow | null> {
  const client = db || supabaseAdmin()
  const { data } = await client
    .from('whatsapp_meta_flows')
    .select('*')
    .eq('account_id', accountId)
    .eq('flow_key', PREFERENCE_FLOW_KEY)
    .eq('status', 'published')
    .maybeSingle()
  return (data as MetaFlowRow) || null
}

/**
 * Send the preference form to a contact. Creates a fresh flow session
 * (cancelling any still-open one for the same contact) and dispatches
 * the interactive flow message through the shared persist pipeline so
 * it shows up in the inbox thread.
 */
export async function sendPreferenceFlowToContact(args: {
  accountId: string
  contactId: string
  senderType?: 'user' | 'bot' | 'agent'
  db?: SupabaseClient
}): Promise<{ success: boolean; error?: string }> {
  const db = args.db || supabaseAdmin()
  const { accountId, contactId } = args

  const flow = await getPublishedPreferenceFlow(accountId, db)
  if (!flow?.meta_flow_id) {
    return {
      success: false,
      error:
        'The preference flow is not set up for this account yet. Publish it from Settings → WhatsApp first.',
    }
  }

  // One live session per contact — supersede older unanswered forms so
  // a stale token can't overwrite newer answers later.
  await db
    .from('whatsapp_meta_flow_sessions')
    .update({ status: 'cancelled' })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('flow_key', PREFERENCE_FLOW_KEY)
    .in('status', ['sent', 'opened'])

  const { data: contact } = await db
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!contact) {
    return { success: false, error: 'Contact not found for this account.' }
  }

  const flowToken = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(
    Date.now() + FLOW_SESSION_TTL_HOURS * 3600 * 1000
  ).toISOString()

  const { error: sessionErr } = await db.from('whatsapp_meta_flow_sessions').insert({
    account_id: accountId,
    contact_id: contactId,
    flow_key: PREFERENCE_FLOW_KEY,
    flow_token: flowToken,
    status: 'sent',
    prefill: buildPreferencePrefillData(contact),
    expires_at: expiresAt,
  })
  if (sessionErr) {
    return { success: false, error: `Failed to create flow session: ${sessionErr.message}` }
  }

  const result = await sendWhatsAppMessageAndPersist({
    accountId,
    contactId,
    kind: 'interactive',
    senderType: args.senderType || 'bot',
    interactiveType: 'flow',
    interactiveBody:
      'Tap below to review and update your property preferences — budget, localities, property types and expected ROI.',
    footerText: 'Takes under a minute',
    flowId: flow.meta_flow_id,
    flowToken,
    flowCta: 'Update my preferences',
  })

  if (!result.success) {
    // Don't leave an orphaned live session behind a failed send.
    await db
      .from('whatsapp_meta_flow_sessions')
      .update({ status: 'cancelled' })
      .eq('flow_token', flowToken)
    return { success: false, error: result.error }
  }
  return { success: true }
}

// ── Applying responses ────────────────────────────────────────────

export interface ApplyPreferenceResult {
  applied: boolean
  alreadyCompleted: boolean
  update?: ContactPreferenceUpdate
  session?: FlowSessionRow
  error?: string
}

/**
 * Validate a flow token and persist the submitted preference values to
 * the contact. Called from BOTH the encrypted data-exchange endpoint
 * (authoritative, at submit time) and the nfm_reply webhook (fallback
 * + chat confirmation) — hence idempotent: a completed session just
 * reports alreadyCompleted so callers can skip re-writing.
 */
export async function applyPreferenceFlowResponse(args: {
  flowToken: string
  values: PreferenceFormValues | Record<string, unknown>
  /** When provided, the session must belong to this account (defense
   *  against cross-tenant token replay via the webhook path). */
  expectedAccountId?: string
  db?: SupabaseClient
}): Promise<ApplyPreferenceResult> {
  const db = args.db || supabaseAdmin()

  const { data: session } = await db
    .from('whatsapp_meta_flow_sessions')
    .select('*')
    .eq('flow_token', args.flowToken)
    .maybeSingle()

  if (!session) {
    return { applied: false, alreadyCompleted: false, error: 'Unknown flow token.' }
  }
  const sess = session as FlowSessionRow
  if (args.expectedAccountId && sess.account_id !== args.expectedAccountId) {
    return {
      applied: false,
      alreadyCompleted: false,
      error: 'Flow token does not belong to this account.',
    }
  }
  if (sess.status === 'completed') {
    return { applied: false, alreadyCompleted: true, session: sess }
  }
  if (sess.status === 'cancelled' || sess.status === 'expired') {
    return {
      applied: false,
      alreadyCompleted: false,
      session: sess,
      error: `Flow session is ${sess.status}.`,
    }
  }
  if (sess.expires_at && new Date(sess.expires_at).getTime() < Date.now()) {
    await db
      .from('whatsapp_meta_flow_sessions')
      .update({ status: 'expired' })
      .eq('id', sess.id)
    return { applied: false, alreadyCompleted: false, error: 'Flow session expired.' }
  }

  const values = parsePreferenceFormValues(args.values as Record<string, unknown>)
  const update = preferenceFormToContactUpdate(values)

  if (Object.keys(update).length > 0) {
    const { error: contactErr } = await db
      .from('contacts')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', sess.contact_id)
      .eq('account_id', sess.account_id)
    if (contactErr) {
      return {
        applied: false,
        alreadyCompleted: false,
        session: sess,
        error: `Failed to save preferences: ${contactErr.message}`,
      }
    }
  }

  await db
    .from('whatsapp_meta_flow_sessions')
    .update({
      status: 'completed',
      response: values as unknown as Record<string, unknown>,
      completed_at: new Date().toISOString(),
    })
    .eq('id', sess.id)

  return { applied: true, alreadyCompleted: false, update, session: sess }
}

/** Mark a session opened (INIT received). Best-effort. */
export async function markFlowSessionOpened(
  flowToken: string,
  db?: SupabaseClient
): Promise<void> {
  const client = db || supabaseAdmin()
  await client
    .from('whatsapp_meta_flow_sessions')
    .update({ status: 'opened' })
    .eq('flow_token', flowToken)
    .eq('status', 'sent')
}

/** Load the session + contact for an INIT prefill. */
export async function getFlowSessionWithContact(
  flowToken: string,
  db?: SupabaseClient
): Promise<{
  session: FlowSessionRow
  contact: Record<string, unknown>
} | null> {
  const client = db || supabaseAdmin()
  const { data: session } = await client
    .from('whatsapp_meta_flow_sessions')
    .select('*')
    .eq('flow_token', flowToken)
    .maybeSingle()
  if (!session) return null
  const sess = session as FlowSessionRow
  const { data: contact } = await client
    .from('contacts')
    .select('*')
    .eq('id', sess.contact_id)
    .eq('account_id', sess.account_id)
    .maybeSingle()
  if (!contact) return null
  return { session: sess, contact: contact as Record<string, unknown> }
}
