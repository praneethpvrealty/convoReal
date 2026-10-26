import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * How long after an agent's message the thread counts as theirs.
 *
 * On 26 October an agent was mid-conversation with a buyer, sharing a
 * villa and its location, when the bot answered one question in between
 * and so became the latest sender. The next message read as the bot's to
 * answer, and five seconds after the agent wrote "Let me share the
 * location" the requirement card went out, playing back a stale brief.
 * The agent had to tell the buyer to ignore the bot. Who wrote last is
 * not who is handling the conversation.
 */
export const AGENT_HANDLING_WINDOW_MS = 10 * 60 * 1000;

/** True when an agent wrote in the thread within the window before
 *  `now`. Messages without a timestamp never count as recent. */
export function agentHandledRecently(
  messages: { sender_type?: string | null; created_at?: string | null }[],
  now: Date = new Date()
): boolean {
  const since = now.getTime() - AGENT_HANDLING_WINDOW_MS;
  return messages.some(
    (message) =>
      message.sender_type === 'agent' &&
      !!message.created_at &&
      Date.parse(message.created_at) > since
  );
}

/** The same test read fresh from the thread, for a handler about to
 *  send: an agent may have written while it was working. */
export async function agentHandlingThread(
  db: SupabaseClient,
  accountId: string,
  conversationId: string | null | undefined,
  now: Date = new Date()
): Promise<boolean> {
  if (!conversationId) return false;
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('account_id', accountId)
    .eq('sender_type', 'agent')
    .gte(
      'created_at',
      new Date(now.getTime() - AGENT_HANDLING_WINDOW_MS).toISOString()
    )
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(
      `[agent-handling] lookup failed for conversation ${conversationId}; holding the bot back:`,
      error.message
    );
    return true;
  }
  return !!data;
}
