import {
  QualificationLeaseBusyError,
  takeDeferredMessage,
  withConversationLease,
  type ConversationLeaseOptions,
} from '@/lib/ai/qualification-lease';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface SerializedInboundArgs<P> {
  accountId: string;
  conversationId: string;
  messageId: string;
  payload: P;
  handle: (payload: P, info: { waited: boolean }) => Promise<void>;
  handleWithoutPayload: (messageId: string) => Promise<void>;
  leaseOptions?: Omit<ConversationLeaseOptions, 'deferPayload'>;
}

export async function runSerializedInbound<P>({
  accountId,
  conversationId,
  messageId,
  payload,
  handle,
  handleWithoutPayload,
  leaseOptions,
}: SerializedInboundArgs<P>): Promise<void> {
  try {
    await withConversationLease(
      accountId,
      conversationId,
      messageId,
      async (id, info) => {
        if (id === messageId) {
          await handle(payload, info);
          return true;
        }
        if (!id) return true;
        const deferred = await takeDeferredMessage(
          accountId,
          conversationId,
          id
        );
        if (deferred) {
          await handle(deferred as P, { waited: true });
        } else {
          await handleWithoutPayload(id);
        }
        return true;
      },
      { ...leaseOptions, deferPayload: payload }
    );
  } catch (err) {
    if (!(err instanceof QualificationLeaseBusyError)) throw err;
    console.error(
      `[serialized-inbound] conversation busy, handlers skipped for ${messageId}:`,
      err
    );
  }
}

export async function isEarliestCustomerMessage(
  conversationId: string,
  messageId: string
): Promise<boolean> {
  try {
    const db = supabaseAdmin();
    const { data: current, error: currentError } = await db
      .from('messages')
      .select('ingest_seq')
      .eq('conversation_id', conversationId)
      .eq('message_id', messageId)
      .maybeSingle();
    if (currentError) throw currentError;
    const seq = (current as { ingest_seq?: number | string | null } | null)
      ?.ingest_seq;
    if (seq == null) return true;
    const { data: earlier, error } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .or(`ingest_seq.lt.${seq},ingest_seq.is.null`)
      .limit(1);
    if (error) throw error;
    return (earlier ?? []).length === 0;
  } catch (err) {
    console.error('[serialized-inbound] first-message check failed:', err);
    return true;
  }
}
