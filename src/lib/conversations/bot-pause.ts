import type { SupabaseClient } from '@supabase/supabase-js';

export const BOT_PAUSED_BLOCKED_MESSAGE =
  'The bot is switched off for this conversation — automated replies are held back. Switch it back on from the chat header.';

export const BOT_PAUSED_NOTICE =
  'Bot is off for this chat. Only you and your team reply here until you switch it back on.';

export const AGENT_REPLY_BOT_PAUSE_MS = 4 * 60 * 60 * 1000;

export interface BotPauseRow {
  bot_paused_at?: string | null;
  bot_paused_until?: string | null;
}

export function botPauseUpdate(
  paused: boolean,
  now: Date = new Date()
): { bot_paused_at: string | null; bot_paused_until: null } {
  return {
    bot_paused_at: paused ? now.toISOString() : null,
    bot_paused_until: null,
  };
}

export function agentReplyBotPauseUpdate(now: Date = new Date()): {
  bot_paused_until: string;
} {
  return {
    bot_paused_until: new Date(
      now.getTime() + AGENT_REPLY_BOT_PAUSE_MS
    ).toISOString(),
  };
}

export function botAutoPausedUntil(
  row: BotPauseRow | null | undefined,
  now: Date = new Date()
): Date | null {
  if (!row?.bot_paused_until) return null;
  const until = new Date(row.bot_paused_until);
  return until.getTime() > now.getTime() ? until : null;
}

export function isBotPausedRow(
  row: BotPauseRow | null | undefined,
  now: Date = new Date()
): boolean {
  return Boolean(row?.bot_paused_at) || botAutoPausedUntil(row, now) !== null;
}

export function botPauseLabel(
  row: BotPauseRow | null | undefined,
  formatTime: (at: Date) => string,
  now: Date = new Date()
): string | null {
  if (row?.bot_paused_at) return 'Bot off';
  const until = botAutoPausedUntil(row, now);
  return until ? `Bot paused till ${formatTime(until)}` : null;
}

export async function isBotPaused(
  db: SupabaseClient,
  accountId: string,
  conversationId: string | null | undefined
): Promise<boolean> {
  if (!conversationId) return false;
  const { data, error } = await db
    .from('conversations')
    .select('bot_paused_at, bot_paused_until')
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
  return isBotPausedRow(data as BotPauseRow | null);
}

export async function isContactBotPaused(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .or(`bot_paused_at.not.is.null,bot_paused_until.gt.${now.toISOString()}`)
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
