// Applying a staff command, and showing the agent what it did.
//
// Split from the parser so the parse stays pure and testable, and so
// the write lands in one place: the same pref_budget_* fields a
// buyer's own band tap writes, which is what makes an agent-filed
// number behave identically in matching.
//
// The acknowledgement is written into the thread as a private note —
// visible in the inbox, never sent to WhatsApp — so the record of who
// changed the brief lives next to the conversation it came from.

import type { SupabaseClient } from '@supabase/supabase-js';
import { rankPropertiesForContact } from '@/lib/radar/engine';
import {
  buildBudgetCommandAck,
  type AgentCommand,
} from '@/lib/whatsapp/agent-commands';

export interface AgentCommandResult {
  kind: AgentCommand['kind'];
  applied: boolean;
  matchCount: number;
  ack: string;
}

export async function applyAgentCommand(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  contactName: string | null;
  conversationId: string;
  command: AgentCommand;
}): Promise<AgentCommandResult> {
  const { db, accountId, userId, contactId, conversationId, command } = args;

  const patch = command.none
    ? { no_budget: true, pref_budget_min: null, pref_budget_max: null }
    : {
        no_budget: false,
        pref_budget_min: command.min,
        pref_budget_max: command.max,
      };

  const { data: saved } = await db
    .from('contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('account_id', accountId)
    .select('id');

  const applied = !!saved?.length;

  // Ranked after the write, so the count the agent reads is what the
  // new budget actually matches.
  let matchCount = 0;
  if (applied) {
    try {
      const matches = await rankPropertiesForContact(db, accountId, contactId, {
        strictArea: true,
      });
      matchCount = matches.length;
    } catch (err) {
      console.error('[agent-command] ranking failed:', err);
    }
  }

  const ack = applied
    ? buildBudgetCommandAck(command, args.contactName, matchCount)
    : '⚠️ Could not update the budget — the contact was not found in this account.';

  // private: true keeps this out of WhatsApp entirely; the inbox
  // renders it as an internal note on the thread.
  const { error } = await db.from('messages').insert({
    account_id: accountId,
    conversation_id: conversationId,
    sender_type: 'agent',
    sender_id: userId,
    content_type: 'text',
    content_text: ack,
    private: true,
    status: 'sent',
    message_id: `cmd-${conversationId}-${command.kind}`,
  });
  if (error) {
    console.error('[agent-command] note insert failed:', error.message);
  }

  return { kind: command.kind, applied, matchCount, ack };
}
