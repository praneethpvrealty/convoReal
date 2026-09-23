import { supabaseAdmin } from '@/lib/supabase/admin';

const LEASE_TABLE = 'conversation_qualification_leases';
const DEFERRED_TABLE = 'conversation_deferred_messages';

export class QualificationLeaseBusyError extends Error {
  constructor(
    readonly conversationId: string,
    options?: { cause?: unknown }
  ) {
    super(
      `Qualification lease for conversation ${conversationId} could not be taken and the message could not be deferred`,
      options
    );
    this.name = 'QualificationLeaseBusyError';
  }
}

export interface ConversationLeaseOptions {
  ttlSeconds?: number;
  renewEveryMs?: number;
  waitMs?: number;
  pollMs?: number;
  maxHoldMs?: number;
  maxDeferredRounds?: number;
  claimRetries?: number;
  claimRetryMs?: number;
  drainDeferred?: boolean;
  deferPayload?: unknown;
  sleep?: (ms: number) => Promise<void>;
}

export interface LeaseRunInfo {
  waited: boolean;
}

type Db = ReturnType<typeof supabaseAdmin>;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function callRpc<T>(
  db: Db,
  fn: string,
  args: Record<string, unknown>
): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

async function deferToHolder(
  db: Db,
  accountId: string,
  conversationId: string,
  messageId: string,
  payload: unknown
): Promise<boolean> {
  if (payload !== undefined) {
    try {
      return (
        (await callRpc<boolean>(db, 'defer_conversation_message', {
          p_account_id: accountId,
          p_conversation_id: conversationId,
          p_message_id: messageId,
          p_payload: payload,
        })) === true
      );
    } catch (err) {
      console.error(
        '[qualification-lease] deferring with payload failed, deferring the id alone:',
        err
      );
    }
  }
  return (
    (await callRpc<boolean>(db, 'defer_conversation_qualification', {
      p_conversation_id: conversationId,
      p_message_id: messageId,
    })) === true
  );
}

export async function takeDeferredMessage(
  accountId: string,
  conversationId: string,
  messageId: string
): Promise<unknown> {
  try {
    const { data, error } = await supabaseAdmin()
      .from(DEFERRED_TABLE)
      .delete()
      .eq('conversation_id', conversationId)
      .eq('account_id', accountId)
      .eq('message_id', messageId)
      .select('payload')
      .maybeSingle();
    if (error) throw error;
    return (data as { payload?: unknown } | null)?.payload ?? null;
  } catch (err) {
    console.error('[qualification-lease] deferred payload read failed:', err);
    return null;
  }
}

export async function withConversationLease(
  accountId: string,
  conversationId: string,
  messageId: string | null,
  run: (messageId: string | null, info: LeaseRunInfo) => Promise<boolean>,
  {
    ttlSeconds = 30,
    renewEveryMs = (ttlSeconds * 1000) / 3,
    waitMs = 30_000,
    pollMs = 250,
    maxHoldMs = 240_000,
    maxDeferredRounds = 5,
    claimRetries = 3,
    claimRetryMs = 250,
    drainDeferred: drainsDeferred = true,
    deferPayload,
    sleep = defaultSleep,
  }: ConversationLeaseOptions = {}
): Promise<boolean> {
  let db: Db;
  try {
    db = supabaseAdmin();
  } catch (err) {
    throw new QualificationLeaseBusyError(conversationId, { cause: err });
  }

  const holder = crypto.randomUUID();
  const deadline = Date.now() + waitMs;
  let waited = false;
  let claimErrors = 0;
  for (;;) {
    let claimed: boolean;
    try {
      claimed =
        (await callRpc<boolean>(db, 'claim_conversation_qualification_lease', {
          p_account_id: accountId,
          p_conversation_id: conversationId,
          p_holder: holder,
          p_ttl_seconds: ttlSeconds,
        })) === true;
    } catch (err) {
      if (++claimErrors > claimRetries) {
        throw new QualificationLeaseBusyError(conversationId, { cause: err });
      }
      console.error(
        `[qualification-lease] claim failed, retrying (${claimErrors}/${claimRetries}):`,
        err
      );
      await sleep(claimRetryMs * 2 ** (claimErrors - 1));
      continue;
    }
    claimErrors = 0;
    if (claimed) break;
    waited = true;

    if (Date.now() >= deadline) {
      if (!messageId) throw new QualificationLeaseBusyError(conversationId);
      let deferred: boolean;
      try {
        deferred = await deferToHolder(
          db,
          accountId,
          conversationId,
          messageId,
          deferPayload
        );
      } catch (err) {
        throw new QualificationLeaseBusyError(conversationId, { cause: err });
      }
      if (deferred) return true;
    }
    await sleep(pollMs);
  }

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    if (Date.now() - startedAt > maxHoldMs) {
      clearInterval(heartbeat);
      console.error(
        `[qualification-lease] held past ${maxHoldMs}ms, letting it expire: conversation=${conversationId}`
      );
      return;
    }
    callRpc<boolean>(db, 'renew_conversation_qualification_lease', {
      p_conversation_id: conversationId,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    })
      .then((held) => {
        if (!held) {
          console.error(
            `[qualification-lease] lease lost while running: conversation=${conversationId}`
          );
        }
      })
      .catch((err) => {
        console.error('[qualification-lease] renew failed:', err);
      });
  }, renewEveryMs);

  const finish = () =>
    callRpc<string[] | null>(db, 'finish_conversation_qualification_lease', {
      p_conversation_id: conversationId,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    });

  const expire = async () => {
    clearInterval(heartbeat);
    try {
      const { error } = await db
        .from(LEASE_TABLE)
        .update({ expires_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('account_id', accountId)
        .eq('holder', holder);
      if (error) throw error;
    } catch (err) {
      console.error('[qualification-lease] expiring the lease failed:', err);
    }
  };

  const drainDeferred = async () => {
    if (!drainsDeferred) {
      await expire();
      return;
    }
    for (let round = 0; round < maxDeferredRounds; round++) {
      let pending: string[];
      try {
        pending = (await finish()) ?? [];
      } catch (err) {
        console.error('[qualification-lease] finish failed:', err);
        await expire();
        return;
      }
      if (pending.length === 0) return;
      for (const deferredId of pending) {
        try {
          await run(deferredId, { waited: true });
        } catch (err) {
          console.error('[qualification-lease] deferred run failed:', err);
        }
      }
    }
    console.error(
      `[qualification-lease] deferred rounds exhausted, leaving the rest to the next holder: conversation=${conversationId}`
    );
    await expire();
  };

  try {
    return await run(messageId, { waited });
  } finally {
    try {
      await drainDeferred();
    } finally {
      clearInterval(heartbeat);
    }
  }
}
