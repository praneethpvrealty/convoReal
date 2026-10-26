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
  const { data } = await db
    .from('conversations')
    .select('bot_paused_at')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle();
  return isBotPausedRow(data as { bot_paused_at?: string | null } | null);
}
