import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { generateJson } from '@/lib/ai/gemini'

/**
 * POST /api/whatsapp/suggest-replies — AI draft replies for the inbox.
 *
 * Reads the recent messages of one conversation and returns 2-3 short
 * reply drafts an agent can tap to insert into the composer (they always
 * edit + send manually — nothing is sent here). On-demand only, so cost
 * is bounded by the agent tapping a button plus the two rate limits.
 *
 * Auth: getCurrentAccount() (accepts the mobile bearer token via the SSR
 * client). Data is RLS-scoped, and the conversation is re-checked against
 * the caller's account_id.
 */

const RECENT_MESSAGES = 15
const MAX_SUGGESTIONS = 3
const MAX_SUGGESTION_CHARS = 300

interface SuggestRequest {
  conversation_id?: unknown
}

/** Gemini JSON mode occasionally wraps output in ``` fences. */
function parseSuggestions(raw: string): string[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return []
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { suggestions?: unknown })?.suggestions)
      ? (parsed as { suggestions: unknown[] }).suggestions
      : []
  return arr
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, MAX_SUGGESTION_CHARS))
    .slice(0, MAX_SUGGESTIONS)
}

const SYSTEM_PROMPT = `You are a helpful assistant for a real-estate agent replying to a client on WhatsApp.
Given the recent conversation, write ${MAX_SUGGESTIONS} short reply options the agent could send next.

Rules:
- Reply in the SAME language and script the client is using (English, Hindi, Hinglish, etc.).
- Keep each reply to one or two sentences — natural, warm, WhatsApp-style, no greetings block or signature.
- Make the options meaningfully different from each other (e.g. answer a question, ask a clarifying question, propose a next step).
- Never invent specific property details, prices, or addresses that are not in the conversation.
- Do not use markdown or numbering.

Respond with ONLY a JSON array of ${MAX_SUGGESTIONS} strings, e.g. ["...", "...", "..."].`

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()

    const userLimit = checkRateLimit(
      `suggest:u:${ctx.userId}`,
      RATE_LIMITS.suggestReplies,
    )
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(
      `suggest:a:${ctx.accountId}`,
      RATE_LIMITS.suggestRepliesDaily,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = (await request.json().catch(() => ({}))) as SuggestRequest
    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : ''
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }

    // Confirm the conversation belongs to the caller's account and pull
    // the contact name for a touch of context.
    const { data: conversation, error: convError } = await ctx.supabase
      .from('conversations')
      .select('id, contact:contacts(name)')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      )
    }

    // Feature degrades gracefully on deployments without a Gemini key.
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ suggestions: [] })
    }

    const { data: messages } = await ctx.supabase
      .from('messages')
      .select('sender_type, content_type, content_text, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(RECENT_MESSAGES)

    const contactRow = Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact
    const contactName =
      (contactRow as { name?: string } | null)?.name?.trim() || 'Client'

    // Oldest → newest for the model, text messages only (media has no
    // body to reason over). No text at all → nothing to reply to → no
    // suggestions.
    const transcript = (messages ?? [])
      .slice()
      .reverse()
      .filter((m) => m.content_type === 'text' && (m.content_text ?? '').trim())
      .map((m) => {
        const who = m.sender_type === 'customer' ? contactName : 'Agent'
        return `${who}: ${(m.content_text ?? '').trim()}`
      })
      .join('\n')

    if (!transcript) {
      return NextResponse.json({ suggestions: [] })
    }

    const raw = await generateJson(
      `Conversation so far:\n${transcript}\n\nWrite the agent's reply options now.`,
      SYSTEM_PROMPT,
      { tier: 'lite', feature: 'suggest_replies' },
    )

    return NextResponse.json({ suggestions: parseSuggestions(raw) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
