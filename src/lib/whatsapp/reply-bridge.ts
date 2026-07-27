// ============================================================
// Direct WhatsApp replies — the bridge between a staff member's own
// WhatsApp chat and a lead's thread in the shared inbox.
//
// The agent-ping notifications ("💬 New lead just messaged you") land
// in the staff member's personal WhatsApp chat with the business
// number. Answering there used to go nowhere: the ping said "Open your
// Inbox to reply", and anything typed back was read as owner-chatbot
// input. This module makes that quote-reply the reply.
//
//   1. Every ping about a conversation is registered as a bridge, keyed
//      on its wamid (migration 171).
//   2. WhatsApp puts `context.id` = that wamid on a quote-reply, so an
//      inbound message can be matched back to the lead's thread —
//      the same trick the appointment reminder buttons use.
//   3. The text is sent to the lead as a normal agent message, and the
//      "✅ Sent" ack is itself registered as a bridge, so the agent can
//      keep quoting to keep talking.
//   4. Once an agent has answered from WhatsApp, the lead's later
//      messages are mirrored to their phone (relayLeadMessageToBridgedAgent)
//      so the conversation doesn't dead-end.
//
// The pure helpers (extractRelayText / isBridgeFresh / the ack
// builders) are transport-free and unit-tested; everything below them
// does the DB + Meta work.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import { phonesMatch, sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import {
  isWithinCustomerWindow,
  isReengagementError,
} from '@/lib/whatsapp/customer-window'
import { canSendMessages, isAccountRole } from '@/lib/auth/roles'
import { BRANDING } from '@/config/branding'

/**
 * How long an answered bridge keeps mirroring the lead's messages to
 * the agent's WhatsApp. Matched to Meta's customer service window: past
 * it the agent could not reply free-form anyway, so a relay would be a
 * dead end.
 */
export const BRIDGE_RELAY_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Bridges older than this are pruned on the next registration. A bridge
 * is only usable while the lead's 24-hour window is open; the extra day
 * of slack keeps a late "why didn't this work?" diagnosis possible.
 */
export const BRIDGE_PRUNE_AFTER_MS = 48 * 60 * 60 * 1000

/** Longest lead message body mirrored to the agent's WhatsApp. */
const RELAY_PREVIEW_LIMIT = 900

export interface ReplyBridgeRow {
  id: string
  account_id: string
  agent_user_id: string
  agent_phone: string
  target_conversation_id: string
  target_contact_id: string
  last_agent_reply_at: string | null
  created_at: string
}

interface RelayableMessage {
  type: string
  text?: { body: string }
}

export type RelayText =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'unsupported_type' }

/**
 * What of an inbound staff message can be forwarded to the lead.
 * Text only: media arrives as a Meta media id that would have to be
 * re-uploaded before it could be sent on, and interactive/location
 * payloads have no meaning in the lead's thread. Anything else is
 * reported back to the agent rather than silently dropped.
 */
export function extractRelayText(
  message: RelayableMessage,
  contentText: string | null | undefined,
): RelayText {
  if (message.type !== 'text') return { ok: false, reason: 'unsupported_type' }
  const text = (message.text?.body ?? contentText ?? '').trim()
  if (!text) return { ok: false, reason: 'empty' }
  return { ok: true, text }
}

/** Whether an answered bridge is still mirroring the lead's messages. */
export function isBridgeFresh(
  lastAgentReplyAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastAgentReplyAt) return false
  const at = new Date(lastAgentReplyAt).getTime()
  if (Number.isNaN(at)) return false
  return now - at < BRIDGE_RELAY_WINDOW_MS
}

/** Trailing hint that tells the agent this message is answerable. */
export const BRIDGE_REPLY_HINT =
  '_Reply to this message and I will send it straight to them._'

export function buildSentAck(leadName: string): string {
  return `✅ Sent to ${leadName}.\n\n${BRIDGE_REPLY_HINT}`
}

export function buildWindowClosedAck(leadName: string, inboxLink: string): string {
  return [
    `⏳ Couldn't send to ${leadName}.`,
    '',
    `WhatsApp only allows a free-form reply within 24 hours of their last message. Open the Inbox to re-engage with an approved template:`,
    inboxLink,
  ].join('\n')
}

export function buildUnsupportedAck(
  leadName: string,
  reason: 'empty' | 'unsupported_type',
  inboxLink: string,
): string {
  const what =
    reason === 'empty'
      ? 'That reply had no text to send.'
      : 'Only text replies can be sent from here.'
  return [`⚠️ Nothing sent to ${leadName}. ${what}`, '', `Open the Inbox for media and templates:`, inboxLink].join('\n')
}

export function buildFailureAck(leadName: string, detail: string): string {
  return `❌ Couldn't send to ${leadName}: ${detail}`
}

/** The lead's message, mirrored into the agent's own WhatsApp chat. */
export function buildLeadRelayText(leadName: string, body: string): string {
  return [`💬 *${leadName}* replied`, '', body.slice(0, RELAY_PREVIEW_LIMIT), '', BRIDGE_REPLY_HINT].join('\n')
}

function inboxLink(conversationId: string): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    BRANDING.websiteUrl ||
    ''
  ).replace(/\/+$/, '')
  return `${base}/inbox?conversation=${conversationId}`
}

/**
 * Records an outbound staff-facing message as a reply bridge, so a
 * WhatsApp quote-reply to it reaches the lead. Best-effort: a bridge
 * that fails to register only costs the direct-reply shortcut, never
 * the notification that carried it.
 *
 * Skipped when the recipient IS the thread's contact — a staff member
 * texting the CRM number from their own phone would otherwise bridge
 * their thread to itself and relay their messages back to them.
 */
export async function registerReplyBridge(args: {
  accountId: string
  agentUserId: string
  agentPhone: string
  wamid: string | null | undefined
  conversationId: string
  /** Carried over when the bridge continues an already-answered thread. */
  lastAgentReplyAt?: string | null
}): Promise<void> {
  const { accountId, agentUserId, agentPhone, wamid, conversationId } = args
  if (!wamid || !agentPhone || !conversationId) return

  try {
    const admin = supabaseAdmin()
    const { data: conversation } = await admin
      .from('conversations')
      .select('id, account_id, contact_id, contact:contacts(phone)')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()

    const contactPhone = (conversation?.contact as { phone?: string } | null)?.phone
    if (!conversation?.contact_id || !contactPhone) return
    if (phonesMatch(contactPhone, agentPhone)) return

    const { error } = await admin.from('whatsapp_reply_bridges').upsert(
      {
        account_id: accountId,
        agent_user_id: agentUserId,
        agent_phone: agentPhone,
        notification_message_id: wamid,
        target_conversation_id: conversationId,
        target_contact_id: conversation.contact_id as string,
        last_agent_reply_at: args.lastAgentReplyAt ?? null,
      },
      { onConflict: 'notification_message_id' },
    )
    if (error) {
      console.error('[reply-bridge] register failed:', error.message)
      return
    }

    await admin
      .from('whatsapp_reply_bridges')
      .delete()
      .eq('account_id', accountId)
      .lt('created_at', new Date(Date.now() - BRIDGE_PRUNE_AFTER_MS).toISOString())
  } catch (err) {
    console.error('[reply-bridge] register error:', err)
  }
}

async function resolveBridge(
  wamid: string,
  accountId: string,
): Promise<ReplyBridgeRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_reply_bridges')
    .select(
      'id, account_id, agent_user_id, agent_phone, target_conversation_id, target_contact_id, last_agent_reply_at, created_at',
    )
    .eq('notification_message_id', wamid)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[reply-bridge] lookup failed:', error.message)
    return null
  }
  return (data as ReplyBridgeRow | null) ?? null
}

/**
 * Staff who may still send on this account. Re-checked at reply time
 * rather than trusted from the bridge row: membership and role can have
 * changed since the ping went out, and a viewer must never be able to
 * message a lead.
 */
async function canStillSend(accountId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('profiles')
    .select('account_role')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  const role = (data as { account_role?: string } | null)?.account_role
  return isAccountRole(role) && canSendMessages(role)
}

async function lastCustomerMessageAt(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { created_at?: string } | null)?.created_at ?? null
}

/** Confirmation back to the agent, itself bridged so they can continue. */
async function ackToAgent(args: {
  accountId: string
  bridge: ReplyBridgeRow
  agentContactId: string
  agentConversationId: string
  text: string
  /** Only a delivered reply keeps the thread answerable from WhatsApp. */
  bridgeAck: boolean
  lastAgentReplyAt?: string | null
}): Promise<void> {
  const ack = await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.bridge.agent_user_id,
    contactId: args.agentContactId,
    conversationId: args.agentConversationId,
    kind: 'text',
    senderType: 'bot',
    text: args.text,
  })
  if (!args.bridgeAck) return
  await registerReplyBridge({
    accountId: args.accountId,
    agentUserId: args.bridge.agent_user_id,
    agentPhone: args.bridge.agent_phone,
    wamid: ack.whatsappMessageId,
    conversationId: args.bridge.target_conversation_id,
    lastAgentReplyAt: args.lastAgentReplyAt ?? null,
  })
}

/**
 * Handles an inbound staff message that quote-replies a bridge message
 * by sending it on to the lead. Returns true when the message was a
 * bridged reply and is fully handled — the caller must then stop, so
 * the text never also reaches the owner chatbot or the digest commands.
 *
 * Returns false for anything that isn't one (no quote, quote of an
 * unrelated message, a bridge quoted by someone other than the staff
 * member it was sent to), leaving normal inbound processing untouched.
 */
export async function handleBridgedAgentReply(args: {
  message: { id: string; type: string; text?: { body: string }; context?: { id: string } }
  contentText: string | null
  accountId: string
  senderPhone: string
  /** The staff member's own contact/conversation — where acks go. */
  agentContactId: string
  agentConversationId: string
}): Promise<boolean> {
  const wamid = args.message.context?.id
  if (!wamid) return false

  try {
    const bridge = await resolveBridge(wamid, args.accountId)
    if (!bridge) return false

    // A forwarded ping quoted by someone else is not authorization.
    if (!phonesMatch(bridge.agent_phone, args.senderPhone)) return false
    if (!(await canStillSend(args.accountId, bridge.agent_user_id))) return false

    // The staff member's own thread is a workflow channel, not a lead —
    // their outgoing reply must not leave an unread badge on it. (The
    // owner's self-chat is already zeroed upstream; teammates' aren't.)
    await supabaseAdmin()
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', args.agentConversationId)
      .eq('account_id', args.accountId)

    const link = inboxLink(bridge.target_conversation_id)
    const { data: leadContact } = await supabaseAdmin()
      .from('contacts')
      .select('name, phone')
      .eq('id', bridge.target_contact_id)
      .eq('account_id', args.accountId)
      .maybeSingle()
    const leadName =
      (leadContact as { name?: string } | null)?.name ||
      (leadContact as { phone?: string } | null)?.phone ||
      'the lead'

    const relay = extractRelayText(args.message, args.contentText)
    if (!relay.ok) {
      await ackToAgent({
        accountId: args.accountId,
        bridge,
        agentContactId: args.agentContactId,
        agentConversationId: args.agentConversationId,
        text: buildUnsupportedAck(leadName, relay.reason, link),
        bridgeAck: false,
      })
      return true
    }

    if (!isWithinCustomerWindow(await lastCustomerMessageAt(bridge.target_conversation_id))) {
      await ackToAgent({
        accountId: args.accountId,
        bridge,
        agentContactId: args.agentContactId,
        agentConversationId: args.agentConversationId,
        text: buildWindowClosedAck(leadName, link),
        bridgeAck: false,
      })
      return true
    }

    const sent = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: bridge.agent_user_id,
      contactId: bridge.target_contact_id,
      conversationId: bridge.target_conversation_id,
      kind: 'text',
      senderType: 'agent',
      text: relay.text,
    })

    if (!sent.success) {
      await ackToAgent({
        accountId: args.accountId,
        bridge,
        agentContactId: args.agentContactId,
        agentConversationId: args.agentConversationId,
        text: isReengagementError(sent.error)
          ? buildWindowClosedAck(leadName, link)
          : buildFailureAck(leadName, sent.error || 'unknown error'),
        bridgeAck: false,
      })
      return true
    }

    const repliedAt = new Date().toISOString()
    const admin = supabaseAdmin()

    // The agent has read and answered this thread from WhatsApp, so the
    // inbox badge must clear the same way sending from the composer does.
    await admin
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', bridge.target_conversation_id)
      .eq('account_id', args.accountId)

    // Stamps the opt-in that starts mirroring the lead's replies.
    await admin
      .from('whatsapp_reply_bridges')
      .update({ last_agent_reply_at: repliedAt })
      .eq('id', bridge.id)

    await ackToAgent({
      accountId: args.accountId,
      bridge,
      agentContactId: args.agentContactId,
      agentConversationId: args.agentConversationId,
      text: buildSentAck(leadName),
      bridgeAck: true,
      lastAgentReplyAt: repliedAt,
    })
    return true
  } catch (err) {
    // The quote matched a bridge — swallow rather than letting a partial
    // failure leak a reply meant for the lead into the chatbot flows.
    console.error('[reply-bridge] handleBridgedAgentReply failed:', err)
    return true
  }
}

/**
 * Mirrors a lead's message to the WhatsApp of the agent who is handling
 * that thread from WhatsApp, and bridges the mirror so they can answer
 * it the same way. No-op for every thread nobody has answered from
 * WhatsApp — which is every thread until an agent opts in by replying
 * to a ping. Returns true when a relay was delivered.
 */
export async function relayLeadMessageToBridgedAgent(args: {
  accountId: string
  conversationId: string
  leadName: string
  body: string
}): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('whatsapp_reply_bridges')
      .select('id, account_id, agent_user_id, agent_phone, target_conversation_id, target_contact_id, last_agent_reply_at, created_at')
      .eq('account_id', args.accountId)
      .eq('target_conversation_id', args.conversationId)
      .not('last_agent_reply_at', 'is', null)
      .order('last_agent_reply_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[reply-bridge] relay lookup failed:', error.message)
      return false
    }

    const bridge = data as ReplyBridgeRow | null
    if (!bridge || !isBridgeFresh(bridge.last_agent_reply_at)) return false
    if (!(await canStillSend(args.accountId, bridge.agent_user_id))) return false

    const agentPhone = sanitizePhoneForMeta(bridge.agent_phone)
    if (!isValidE164(agentPhone)) return false

    const relayed = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: bridge.agent_user_id,
      toPhone: agentPhone,
      kind: 'text',
      senderType: 'bot',
      text: buildLeadRelayText(args.leadName, args.body),
    })
    if (!relayed.success) return false

    await registerReplyBridge({
      accountId: args.accountId,
      agentUserId: bridge.agent_user_id,
      agentPhone: bridge.agent_phone,
      wamid: relayed.whatsappMessageId,
      conversationId: bridge.target_conversation_id,
      lastAgentReplyAt: bridge.last_agent_reply_at,
    })
    return true
  } catch (err) {
    console.error('[reply-bridge] relay error:', err)
    return false
  }
}
