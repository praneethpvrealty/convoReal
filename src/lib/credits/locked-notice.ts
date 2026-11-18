import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';

export const CREDITS_LOCKED_NOTICE_PREFIX = '🔒 *Out of AI credits';
export const CREDITS_LOCKED_NOTICE_WINDOW_MS = 6 * 60 * 60 * 1000;
export const CREDITS_LOCKED_NOTICE_BURST_MS = 60 * 1000;

export async function claimCreditsLockedNotice(
  accountId: string,
  conversationId: string,
  now: number = Date.now()
): Promise<boolean> {
  const since = new Date(now - CREDITS_LOCKED_NOTICE_WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'bot')
    .like('content_text', `${CREDITS_LOCKED_NOTICE_PREFIX}%`)
    .gte('created_at', since)
    .limit(1);
  if (error || (data && data.length > 0)) return false;

  const claim = await checkRateLimit(
    `credits-locked-notice:${conversationId}`,
    { limit: 1, windowMs: CREDITS_LOCKED_NOTICE_BURST_MS }
  );
  return claim.success;
}
