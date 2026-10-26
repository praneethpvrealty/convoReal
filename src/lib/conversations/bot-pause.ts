import type { SupabaseClient } from '@supabase/supabase-js';

export const BOT_PAUSED_BLOCKED_MESSAGE =
  'The bot is switched off for this conversation — automated replies are held back. Switch it back on from the chat header.';

export const BOT_PAUSED_NOTICE =
  'Bot is off for this chat. Only you and your team reply here until you switch it back on.';

export function botPauseUpdate(
  paused: boolean,
  now: Date = new Date()
): { bot_paused_at: string | null } {
  return { bot_paused_at: paused ? now.toISOString() : null };
}

export function isBotPausedRow(
  row: { bot_paused_at?: string | null } | null | undefined
): boolean {
  return Boolean(row?.bot_paused_at);
}

export async function isBotPaused(
  db: SupabaseClient,
  accountId: string,
  conversationId: string | null | undefined
): Promise<boolean> {
  if (!conversationId) return false;
  const { data, error } = await db
    .from('conversations')
    .select('bot_paused_at')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error(
      `[bot-pause] lookup failed for conversation ${conversationId}; holding the bot back:`,
      error.message
    );
    return true;
  }
  return isBotPausedRow(data as { bot_paused_at?: string | null } | null);
}

export async function isContactBotPaused(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .not('bot_paused_at', 'is', null)
    .limit(1);
  if (error) {
    console.error(
      `[bot-pause] lookup failed for contact ${contactId}; holding the bot back:`,
      error.message
    );
    return true;
  }
  return (data?.length ?? 0) > 0;
}
