// Has a human agent taken this conversation over?
//
// Once an agent is talking to a lead, the bot must stop starting things
// on its own. Hari's thread is the case this exists for: an agent had
// been answering him for an hour when his question ("...which one is
// the one we are talking here") tripped a keyword and the welcome
// funnel restarted underneath the conversation.
//
// Deliberately narrow: this suppresses flow ENTRY only. An already
// running flow still advances (the lead is mid-answer and expects it),
// and every other bot reply — quick-reply handlers, consent commands —
// is a direct answer to something the lead just asked for.

import type { SupabaseClient } from '@supabase/supabase-js';

/** How long an agent's reply holds the conversation. Matches the
 *  24-hour service window: while the lead can still be answered
 *  free-form, the person answering is the one who was already there. */
export const AGENT_TAKEOVER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * True when a human agent has sent a message in this conversation
 * within the takeover window. Bot and system messages don't count —
 * only a person choosing to reply.
 *
 * Fails OPEN (returns false) on a lookup error: losing a greeting is
 * better than silently disabling every funnel on a transient failure.
 */
export async function hasRecentAgentReply(
  db: SupabaseClient,
  conversationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const since = new Date(now.getTime() - AGENT_TAKEOVER_WINDOW_MS).toISOString();
    const { data, error } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'agent')
      .gte('created_at', since)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Belt and braces for the pause that runs when an agent SENDS: stand
 * down any flow run still active on a thread a human is handling,
 * checked when the lead's next message arrives.
 *
 * The send-time pause is the primary mechanism and now uses the admin
 * client; this catches a run that outlived it — one started before the
 * takeover, or an agent reply that reached the lead by some path other
 * than the dispatcher. Returns how many runs were stood down.
 */
export async function standDownActiveFlowRuns(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<number> {
  try {
    const { data, error } = await db
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active')
      .select('id');
    if (error) {
      console.error('[agent-takeover] stand-down failed:', error.message);
      return 0;
    }
    return data?.length ?? 0;
  } catch (err) {
    console.error('[agent-takeover] stand-down threw:', err);
    return 0;
  }
}
