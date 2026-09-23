import {
  QualificationLeaseBusyError,
  withConversationLease,
} from '@/lib/ai/qualification-lease';
import { lookupConversation } from '@/lib/conversations/resolve';
import { supabaseAdmin } from './admin-client';
import { resumePendingExecution, type AutomationContext } from './engine';

export const RESUME_BATCH_LIMIT = 50;
export const RESUME_STALE_SECONDS = 900;
export const RESUME_MAX_ATTEMPTS = 3;
export const RESUME_LEASE_TTL_SECONDS = 10;
export const RESUME_LEASE_MAX_HOLD_MS = 10_000;
export const RESUME_CONCURRENCY = 5;
export const RESUME_TIME_BUDGET_MS = 240_000;

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
  run_at: string;
  claim_token: string;
}

export interface DrainResult {
  processed: number;
  deferred: number;
  skipped: number;
}

export interface DrainOptions {
  limit?: number;
  concurrency?: number;
  budgetMs?: number;
}

type Outcome = keyof DrainResult;

type Target =
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'none' }
  | { kind: 'error' };

async function resolveTarget(
  row: ClaimedPendingRow,
  deadline: number
): Promise<Target> {
  const fromContext = row.context?.conversation_id;
  if (fromContext) return { kind: 'conversation', conversationId: fromContext };
  if (!row.contact_id) return { kind: 'none' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(deadline - Date.now(), 0));
  });
  const lookup = await Promise.race([
    lookupConversation<{ id: string }>(supabaseAdmin(), {
      accountId: row.account_id,
      contactId: row.contact_id,
      columns: 'id',
    }),
    timedOut,
  ]);
  clearTimeout(timer);
  if (!lookup) {
    console.error(
      `[automations] conversation lookup for pending execution ${row.id} outlasted the time budget, it retries next tick`
    );
    return { kind: 'error' };
  }
  const { conversation, error } = lookup;
  if (error) {
    console.error(
      `[automations] conversation lookup for pending execution ${row.id} failed, it retries next tick:`,
      error
    );
    return { kind: 'error' };
  }
  return conversation?.id
    ? { kind: 'conversation', conversationId: conversation.id }
    : { kind: 'none' };
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

async function execute(row: ClaimedPendingRow): Promise<Outcome> {
  const { data, error } = await supabaseAdmin()
    .from('automation_pending_executions')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('claim_token', row.claim_token)
    .eq('status', 'running')
    .select('id')
    .maybeSingle();
  if (error) {
    console.error(
      `[automations] could not confirm the claim on pending execution ${row.id}, it retries next tick:`,
      error
    );
    await releaseClaim(row);
    return 'deferred';
  }
  if (!data) {
    console.warn(
      `[automations] pending execution ${row.id} was reclaimed by another run, skipping`
    );
    return 'skipped';
  }
  await resume(row);
  return 'processed';
}

async function runClaimed(
  row: ClaimedPendingRow,
  deadline: number
): Promise<Outcome> {
  const target = await resolveTarget(row, deadline);
  if (target.kind === 'error' || Date.now() >= deadline) {
    await releaseClaim(row);
    return 'deferred';
  }
  if (target.kind === 'none') return execute(row);
  let outcome: Outcome = 'deferred';
  try {
    await withConversationLease(
      row.account_id,
      target.conversationId,
      null,
      async () => {
        outcome = await execute(row);
        return true;
      },
      {
        waitMs: 0,
        drainDeferred: false,
        ttlSeconds: RESUME_LEASE_TTL_SECONDS,
        maxHoldMs: RESUME_LEASE_MAX_HOLD_MS,
      }
    );
    return outcome;
  } catch (err) {
    if (!(err instanceof QualificationLeaseBusyError)) throw err;
    console.warn(
      `[automations] conversation ${target.conversationId} is busy, pending execution ${row.id} retries next tick`
    );
    await releaseClaim(row);
    return 'deferred';
  }
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) await worker(items[next++]);
    }
  );
  await Promise.all(lanes);
}

function groupKey(row: ClaimedPendingRow): string {
  if (row.contact_id) return `contact:${row.contact_id}`;
  const conversationId = row.context?.conversation_id;
  return conversationId ? `conversation:${conversationId}` : `row:${row.id}`;
}

export async function drainPendingExecutions({
  limit = RESUME_BATCH_LIMIT,
  concurrency = RESUME_CONCURRENCY,
  budgetMs = RESUME_TIME_BUDGET_MS,
}: DrainOptions = {}): Promise<DrainResult> {
  const deadline = Date.now() + budgetMs;
  const { data, error } = await supabaseAdmin().rpc(
    'claim_automation_pending_executions',
    {
      p_limit: limit,
      p_stale_seconds: RESUME_STALE_SECONDS,
      p_max_attempts: RESUME_MAX_ATTEMPTS,
    }
  );
  if (error) throw error;

  const rows = ((data ?? []) as ClaimedPendingRow[]).sort(
    (a, b) => Date.parse(a.run_at) - Date.parse(b.run_at)
  );
  const groups = new Map<string, ClaimedPendingRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const result: DrainResult = { processed: 0, deferred: 0, skipped: 0 };
  await runPool([...groups.values()], concurrency, async (group) => {
    for (const row of group) {
      if (Date.now() >= deadline) {
        await releaseClaim(row);
        result.deferred++;
        continue;
      }
      try {
        result[await runClaimed(row, deadline)]++;
      } catch (err) {
        console.error(`[automations] resuming ${row.id} failed:`, err);
      }
    }
  });
  return result;
}
