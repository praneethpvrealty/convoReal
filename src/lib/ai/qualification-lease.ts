import { supabaseAdmin } from '@/lib/supabase/admin';

const LEASE_TABLE = 'conversation_qualification_leases';
const DEFERRED_TABLE = 'conversation_deferred_messages';

export class QualificationLeaseBusyError extends Error {
  constructor(
    readonly conversationId: string,
    options?: { cause?: unknown }
  ) {
    super(
      `Qualification lease for conversation ${conversationId} is held and the message could not be deferred`,
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
    deferPayload,
    sleep = defaultSleep,
  }: ConversationLeaseOptions = {}
): Promise<boolean> {
  let db: Db;
  try {
    db = supabaseAdmin();
  } catch (err) {
    console.error('[qualification-lease] no client, running unlocked:', err);
    return run(messageId, { waited: false });
  }

  const holder = crypto.randomUUID();
  const deadline = Date.now() + waitMs;
  let waited = false;
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
      console.error(
        '[qualification-lease] claim failed, running unlocked:',
        err
      );
      return run(messageId, { waited });
    }
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

  const release = async () => {
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
  };

  const drainDeferred = async () => {
    for (let round = 0; round < maxDeferredRounds; round++) {
      let pending: string[];
      try {
        pending = (await finish()) ?? [];
      } catch (err) {
        console.error('[qualification-lease] finish failed:', err);
        await release();
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
      `[qualification-lease] deferred rounds exhausted, releasing: conversation=${conversationId}`
    );
    await release();
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
