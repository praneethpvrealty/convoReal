/**
 * The forwarded client reply whose person the Engine could not name.
 *
 * A screenshot that yields no matchable name used to end the exchange:
 * the parse was discarded and the agent was told to save the contact
 * and forward the chat again. Agents answer that with the name — "he
 * is already a contact" — and the assistant, holding nothing, replied
 * "I couldn't tell what that was".
 *
 * The parse is parked here (pending_client_replies, migration 20260822032705) and
 * claimed by the agent's next message once it names the person. One
 * row per sender, consumed on read, and ignored past
 * PENDING_CLIENT_REPLY_TTL_MS — a stale parse filed onto whoever is
 * named hours later puts one client's words on another's journey.
 */

import type { ParsedClientReply } from '@/lib/ai/gemini';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const PENDING_CLIENT_REPLY_TTL_MS = 60 * 60 * 1000;

export async function parkClientReply(input: {
  accountId: string;
  contactId: string;
  conversationId: string;
  parsed: ParsedClientReply;
}): Promise<void> {
  try {
    await supabaseAdmin().from('pending_client_replies').upsert(
      {
        account_id: input.accountId,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        parsed: input.parsed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'contact_id' }
    );
  } catch (err) {
    console.error('[client-response] parkClientReply failed:', err);
  }
}

/** Claims the sender's parked reply, if one is still fresh. Consumed on
 *  read: the name answers this parse once. */
export async function takePendingClientReply(input: {
  accountId: string;
  contactId: string;
}): Promise<ParsedClientReply | null> {
  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from('pending_client_replies')
      .select('id, parsed, updated_at')
      .eq('account_id', input.accountId)
      .eq('contact_id', input.contactId)
      .maybeSingle();
    if (!data) return null;

    await db.from('pending_client_replies').delete().eq('id', data.id);

    const age = Date.now() - new Date(data.updated_at as string).getTime();
    if (age > PENDING_CLIENT_REPLY_TTL_MS) return null;
    return data.parsed as ParsedClientReply;
  } catch (err) {
    console.error('[client-response] takePendingClientReply failed:', err);
    return null;
  }
}
