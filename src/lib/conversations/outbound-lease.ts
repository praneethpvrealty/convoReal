import type { SupabaseClient } from '@supabase/supabase-js';
import {
  QualificationLeaseBusyError,
  withConversationLease,
} from '@/lib/ai/qualification-lease';
import { lookupConversation } from '@/lib/conversations/resolve';

export const OUTBOUND_LEASE_TTL_SECONDS = 10;
export const OUTBOUND_LEASE_MAX_HOLD_MS = 10_000;

export type OutboundLeaseResult<T> =
  | { status: 'ran'; value: T }
  | { status: 'busy' }
  | { status: 'lookup_failed' }
  | { status: 'no_conversation' };

export async function withContactConversationLease<T>(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  run: () => Promise<T>,
  {
    waitMs = 0,
    requireConversation = false,
  }: { waitMs?: number; requireConversation?: boolean } = {}
): Promise<OutboundLeaseResult<T>> {
  const { conversation, error } = await lookupConversation<{ id: string }>(db, {
    accountId,
    contactId,
    columns: 'id',
  });
  if (error) {
    console.error(
      `[outbound-lease] conversation lookup for contact ${contactId} failed:`,
      error
    );
    return { status: 'lookup_failed' };
  }
  if (!conversation?.id) {
    if (requireConversation) return { status: 'no_conversation' };
    return { status: 'ran', value: await run() };
  }

  let result: OutboundLeaseResult<T> = { status: 'busy' };
  try {
    await withConversationLease(
      accountId,
      conversation.id,
      null,
      async () => {
        result = { status: 'ran', value: await run() };
        return true;
      },
      {
        waitMs,
        drainDeferred: false,
        ttlSeconds: OUTBOUND_LEASE_TTL_SECONDS,
        maxHoldMs: OUTBOUND_LEASE_MAX_HOLD_MS,
      }
    );
  } catch (err) {
    if (!(err instanceof QualificationLeaseBusyError)) throw err;
    console.warn(
      `[outbound-lease] conversation ${conversation.id} is busy, leaving contact ${contactId} for the next run`
    );
    return { status: 'busy' };
  }
  return result;
}
