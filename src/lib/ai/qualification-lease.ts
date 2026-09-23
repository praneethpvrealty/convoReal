import { supabaseAdmin } from '@/lib/supabase/admin';

const LEASE_TABLE = 'conversation_qualification_leases';
const CLAIM_FUNCTION = 'claim_conversation_qualification_lease';

export interface ConversationLeaseOptions {
  ttlSeconds?: number;
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withConversationLease<T>(
  accountId: string,
  conversationId: string,
  run: () => Promise<T>,
  {
    ttlSeconds = 60,
    waitMs = 20_000,
    pollMs = 250,
    sleep = defaultSleep,
  }: ConversationLeaseOptions = {}
): Promise<T> {
  const holder = crypto.randomUUID();
  let db: ReturnType<typeof supabaseAdmin> | null = null;
  let held = false;
  try {
    db = supabaseAdmin();
    const deadline = Date.now() + waitMs;
    for (;;) {
      const { data, error } = await db.rpc(CLAIM_FUNCTION, {
        p_account_id: accountId,
        p_conversation_id: conversationId,
        p_holder: holder,
        p_ttl_seconds: ttlSeconds,
      });
      if (error) {
        console.error('[qualification-lease] claim failed:', error);
        break;
      }
      if (data === true) {
        held = true;
        break;
      }
      if (Date.now() >= deadline) {
        console.warn(
          `[qualification-lease] still held after ${waitMs}ms, proceeding: conversation=${conversationId}`
        );
        break;
      }
      await sleep(pollMs);
    }
  } catch (err) {
    console.error('[qualification-lease] claim failed:', err);
  }

  try {
    return await run();
  } finally {
    if (held && db) {
      try {
        const { error } = await db
          .from(LEASE_TABLE)
          .delete()
          .eq('conversation_id', conversationId)
          .eq('account_id', accountId)
          .eq('holder', holder);
        if (error) throw error;
      } catch (err) {
        console.error('[qualification-lease] release failed:', err);
      }
    }
  }
}
