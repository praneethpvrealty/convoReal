import {
  QualificationLeaseBusyError,
  withConversationLease,
} from '@/lib/ai/qualification-lease';
import { findConversation } from '@/lib/conversations/resolve';
import { supabaseAdmin } from './admin-client';
import { resumePendingExecution, type AutomationContext } from './engine';

export const RESUME_BATCH_LIMIT = 50;
export const RESUME_STALE_SECONDS = 900;
export const RESUME_MAX_ATTEMPTS = 3;
export const RESUME_LEASE_TTL_SECONDS = 10;
export const RESUME_LEASE_MAX_HOLD_MS = 10_000;

interface ClaimedPendingRow {
  id: string;
  automation_id: string;
  account_id: string;
  user_id: string;
  contact_id: string | null;
  log_id: string | null;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  next_step_position: number;
  context: AutomationContext | null;
  claim_token: string;
}

export interface DrainResult {
  processed: number;
  deferred: number;
}

async function leaseConversationId(
  row: ClaimedPendingRow
): Promise<string | null> {
  const fromContext = row.context?.conversation_id;
  if (fromContext) return fromContext;
  if (!row.contact_id) return null;
  const conversation = await findConversation<{ id: string }>(supabaseAdmin(), {
    accountId: row.account_id,
    contactId: row.contact_id,
    columns: 'id',
  });
  return conversation?.id ?? null;
}

async function resume(row: ClaimedPendingRow): Promise<void> {
  await resumePendingExecution({
    id: row.id,
    automation_id: row.automation_id,
    account_id: row.account_id,
    user_id: row.user_id,
    contact_id: row.contact_id ?? null,
    log_id: row.log_id ?? null,
    parent_step_id: row.parent_step_id ?? null,
    branch: row.branch ?? null,
    next_step_position: row.next_step_position,
    context: row.context ?? {},
    claim_token: row.claim_token,
  });
}

async function releaseClaim(row: ClaimedPendingRow): Promise<void> {
  const { error } = await supabaseAdmin().rpc(
    'release_automation_pending_execution',
    { p_id: row.id, p_claim_token: row.claim_token }
  );
  if (error) {
    console.error(
      `[automations] releasing pending execution ${row.id} failed; it is retried once its claim goes stale:`,
      error
    );
  }
}

async function runClaimed(row: ClaimedPendingRow): Promise<boolean> {
  const conversationId = await leaseConversationId(row);
  if (!conversationId) {
    await resume(row);
    return true;
  }
  try {
    await withConversationLease(
      row.account_id,
      conversationId,
      null,
      async (deferredId) => {
        if (deferredId !== null) {
          console.error(
            `[automations] inbound message ${deferredId} was deferred to a resume of ${row.id}; its handlers are skipped`
          );
          return true;
        }
        await resume(row);
        return true;
      },
      {
        waitMs: 0,
        ttlSeconds: RESUME_LEASE_TTL_SECONDS,
        maxHoldMs: RESUME_LEASE_MAX_HOLD_MS,
      }
    );
    return true;
  } catch (err) {
    if (!(err instanceof QualificationLeaseBusyError)) throw err;
    console.warn(
      `[automations] conversation ${conversationId} is busy, pending execution ${row.id} retries next tick`
    );
    await releaseClaim(row);
    return false;
  }
}

export async function drainPendingExecutions(
  limit = RESUME_BATCH_LIMIT
): Promise<DrainResult> {
  const { data, error } = await supabaseAdmin().rpc(
    'claim_automation_pending_executions',
    {
      p_limit: limit,
      p_stale_seconds: RESUME_STALE_SECONDS,
      p_max_attempts: RESUME_MAX_ATTEMPTS,
    }
  );
  if (error) throw error;

  const result: DrainResult = { processed: 0, deferred: 0 };
  for (const row of (data ?? []) as ClaimedPendingRow[]) {
    try {
      if (await runClaimed(row)) result.processed++;
      else result.deferred++;
    } catch (err) {
      console.error(`[automations] resuming ${row.id} failed:`, err);
    }
  }
  return result;
}
