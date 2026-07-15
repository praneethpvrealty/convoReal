import { NextRequest } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  decryptFlowRequest,
  encryptFlowResponse,
  FlowDecryptionError,
} from '@/lib/whatsapp/flow-crypto'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import {
  applyPreferenceFlowResponse,
  getFlowSessionWithContact,
  markFlowSessionOpened,
} from '@/lib/whatsapp/meta-flow-service'
import {
  PREFERENCE_SCREEN_ID,
  buildPreferencePrefillData,
} from '@/lib/whatsapp/preference-flow'

/**
 * Meta WhatsApp Flows data-exchange endpoint (per-tenant).
 *
 * Meta calls this URL (configured as the flow's endpoint_uri) whenever a
 * buyer interacts with an endpoint-backed flow:
 *   - health check pings                        -> { data: { status: 'active' } }
 *   - client error notifications                -> { data: { acknowledged: true } }
 *   - INIT (flow opened)                        -> PREFERENCES screen, prefilled
 *   - data_exchange (form submitted)            -> preferences saved, flow closed
 *
 * Every request body is encrypted (see flow-crypto.ts) and every 200
 * response must be the base64 ciphertext of the JSON response — NOT
 * plain JSON. Meaningful HTTP error codes (Meta-specified):
 *   421 — we couldn't decrypt: client re-fetches the business public key
 *   427 — flow token invalid/expired: client shows an error and closes
 *   432 — request signature verification failed
 */

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

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await ctx.params
  const rawBody = await request.text()

  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    return new Response('Invalid request signature', { status: 432 })
  }

  const { data: config } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id, flows_private_key')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!config?.flows_private_key) {
    console.error(`[flows-endpoint] No flows private key for account ${accountId}`)
    return new Response('Flow encryption is not configured', { status: 421 })
  }

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody)
  } catch {
    return new Response('Malformed JSON body', { status: 400 })
  }

  let decrypted
  try {
    decrypted = decryptFlowRequest(parsedBody, decrypt(config.flows_private_key))
  } catch (err) {
    if (err instanceof FlowDecryptionError) {
      console.error(`[flows-endpoint] Decryption failed for ${accountId}: ${err.message}`)
      return new Response('Unable to decrypt request', { status: 421 })
    }
    throw err
  }

  const { payload, aesKey, initialVector } = decrypted
  const respond = (response: Record<string, unknown>, status = 200) =>
    new Response(encryptFlowResponse(response, aesKey, initialVector), {
      status,
      headers: { 'Content-Type': 'text/plain' },
    })

  // Health check — Meta pings periodically and before publishing.
  if (payload.action === 'ping') {
    return respond({ data: { status: 'active' } })
  }

  // Client-side error notification — acknowledge so Meta stops retrying.
  if (payload.data && 'error' in payload.data) {
    console.error(
      `[flows-endpoint] Client error for ${accountId}:`,
      JSON.stringify(payload.data)
    )
    return respond({ data: { acknowledged: true } })
  }

  const flowToken = payload.flow_token
  if (!flowToken) {
    return new Response('Missing flow token', { status: 427 })
  }

  if (payload.action === 'INIT' || payload.action === 'BACK') {
    const sessionWithContact = await getFlowSessionWithContact(flowToken)
    if (!sessionWithContact) {
      return new Response('Unknown flow token', { status: 427 })
    }
    const { session, contact } = sessionWithContact
    if (session.account_id !== accountId) {
      return new Response('Flow token does not belong to this tenant', { status: 427 })
    }
    if (['cancelled', 'expired', 'completed'].includes(session.status)) {
      return new Response(`Flow session is ${session.status}`, { status: 427 })
    }
    if (payload.action === 'INIT') {
      await markFlowSessionOpened(flowToken)
    }
    return respond({
      screen: PREFERENCE_SCREEN_ID,
      data: buildPreferencePrefillData(contact),
    })
  }

  if (payload.action === 'data_exchange') {
    const result = await applyPreferenceFlowResponse({
      flowToken,
      values: payload.data || {},
      expectedAccountId: accountId,
    })

    if (result.applied || result.alreadyCompleted) {
      // Closing handshake: the client completes the flow and WhatsApp
      // delivers an nfm_reply webhook carrying these params, which is
      // where the in-chat confirmation is sent.
      return respond({
        screen: 'SUCCESS',
        data: {
          extension_message_response: {
            params: { flow_token: flowToken },
          },
        },
      })
    }

    console.error(
      `[flows-endpoint] data_exchange rejected for ${accountId}: ${result.error}`
    )
    return new Response(result.error || 'Invalid flow session', { status: 427 })
  }

  console.error(`[flows-endpoint] Unsupported action "${payload.action}" for ${accountId}`)
  return new Response('Unsupported action', { status: 422 })
}
