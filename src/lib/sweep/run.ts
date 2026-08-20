// ============================================================
// The morning run.
//
// Order matters here and is not arbitrary:
//
//   1. Claim the ledger row FIRST. The claim is an insert against a
//      unique (account_id, run_date) index, so a second cron tick —
//      a platform retry, someone poking the endpoint — loses the race
//      and returns instead of paying for the same reading twice.
//   2. Run the free detectors over every thread. These cost nothing,
//      so an account out of credits still gets a correct digest about
//      everything that is a matter of shape rather than judgement.
//   3. Spend on analysis only after that, thread by thread, stopping
//      the moment credits or the daily cap say so. Burning per thread
//      rather than per run means a run that dies halfway has charged
//      for exactly what it read.
//   4. Digest last, from what was actually written.
//
// Nothing in a run may throw past the account boundary. One account's
// bad data must not cost every other account on the platform its
// morning.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { recordLearnedFacts } from '@/lib/learning/record';
import { analyzeThread } from './analyze';
import {
  MAX_THREADS_PER_ACCOUNT,
  collectClientThreads,
  collectContexts,
  collectPersonalThreads,
  threadKey,
} from './collect';
import { detectGaps } from './detectors';
import { worthAnalyzing } from './transcript';
import { persistGaps } from './gaps';
import { sendSweepDigest, type DigestGap } from './digest';
import { boundaryHasPassed, sweepWindow } from './window';
import type { SweepThread, ThreadContext } from './types';

const AI_FEATURE = 'conversation_sweep_thread' as const;

/**
 * Threads read by the model per account per morning.
 *
 * Below the collection cap on purpose. Collection decides what the
 * free detectors see, which is cheap and should be generous; this
 * decides what gets paid for. An account whose fortieth-busiest
 * thread of the day holds the one unkept promise is a real loss, and
 * a smaller one than an unbounded daily bill nobody agreed to.
 */
const MAX_ANALYZED_PER_ACCOUNT = 25;

type Db = ReturnType<typeof supabaseAdmin>;

export interface AccountSweepResult {
  accountId: string;
  status: 'completed' | 'skipped' | 'failed';
  detail?: string;
  threadsSeen: number;
  threadsAnalyzed: number;
  factsApplied: number;
  factsProposed: number;
  gapsOpened: number;
  digestSent: boolean;
}

/**
 * Accounts with any conversation activity in the window.
 *
 * Driven off activity rather than off the account list: a platform
 * with a thousand accounts and forty active ones should do forty
 * accounts' work. `conversations.last_message_at` is the cheapest
 * proxy — one row per thread rather than one per message.
 */
async function activeAccounts(
  db: Db,
  window: { start: Date; end: Date }
): Promise<string[]> {
  const ids = new Set<string>();

  const [conversations, journey] = await Promise.all([
    db
      .from('conversations')
      .select('account_id')
      .gte('last_message_at', window.start.toISOString())
      .lt('last_message_at', window.end.toISOString())
      .limit(5000),
    db
      .from('journey_events')
      .select('account_id')
      .eq('event_type', 'outbound_whatsapp')
      .gte('created_at', window.start.toISOString())
      .lt('created_at', window.end.toISOString())
      .limit(5000),
  ]);

  for (const row of (conversations.data as { account_id: string }[] | null) ??
    [])
    ids.add(row.account_id);
  for (const row of (journey.data as { account_id: string }[] | null) ?? [])
    ids.add(row.account_id);

  return [...ids];
}

/** The account holder the digest goes to. */
async function accountHolder(
  db: Db,
  accountId: string
): Promise<string | null> {
  const { data } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('account_role', 'owner')
    .limit(1)
    .maybeSingle();
  return (data as { user_id: string } | null)?.user_id ?? null;
}

/** The record as it reads now, for the novelty check inside
 *  recordLearnedFacts — it audits `previous_value` from this. */
async function currentRow(
  db: Db,
  table: 'contacts' | 'properties',
  accountId: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from(table)
    .select('*')
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * Files what a thread's analysis believed, through the one door every
 * learner uses. The field whitelist, the bounds and the
 * apply-vs-propose policy all live in src/lib/learning/fields.ts —
 * the sweep's opinion about a field carries no more weight than any
 * other learner's.
 */
async function applyFacts(
  db: Db,
  accountId: string,
  thread: SweepThread,
  facts: Awaited<ReturnType<typeof analyzeThread>>['facts']
): Promise<{ applied: number; proposed: number }> {
  let applied = 0;
  let proposed = 0;

  const byEntity = {
    contact: facts.filter((f) => f.entity === 'contact'),
    property: facts.filter((f) => f.entity === 'property'),
  };

  const targets: {
    entity: 'contact' | 'property';
    table: 'contacts' | 'properties';
    id: string | null;
  }[] = [
    { entity: 'contact', table: 'contacts', id: thread.contactId },
    { entity: 'property', table: 'properties', id: thread.propertyId },
  ];

  for (const target of targets) {
    const list = byEntity[target.entity];
    if (!list.length || !target.id) continue;

    const current = await currentRow(db, target.table, accountId, target.id);
    if (!current) continue;

    const result = await recordLearnedFacts({
      db,
      accountId,
      entity: target.entity,
      entityId: target.id,
      current,
      facts: list.map((f) => ({ field: f.field, value: f.value })),
      // The evidence sentences joined, because a removal from an
      // auto-applied list is only allowed when the evidence NAMES what
      // is being removed, and each fact carries its own sentence.
      evidence: list.map((f) => f.evidence).join(' | '),
      source: 'daily_sweep',
      contactId: thread.contactId,
      conversationId: thread.conversationId,
    });

    applied += result.applied.length;
    proposed += result.proposed.length;
  }

  return { applied, proposed };
}

/** Open gaps to name in this morning's digest. Read back from the
 *  table rather than from what this run produced, so a gap that has
 *  been outstanding for four days is reported with its real age. */
async function openGapsFor(db: Db, accountId: string): Promise<DigestGap[]> {
  const { data } = await db
    .from('conversation_gaps')
    .select('kind, severity, summary, occurrence_count')
    .eq('account_id', accountId)
    .eq('status', 'open')
    .order('occurred_at', { ascending: false })
    .limit(50);

  type Row = {
    kind: DigestGap['kind'];
    severity: DigestGap['severity'];
    summary: string;
    occurrence_count: number;
  };
  return ((data as Row[] | null) ?? []).map((row) => ({
    kind: row.kind,
    severity: row.severity,
    summary: row.summary,
    occurrenceCount: row.occurrence_count,
  }));
}

export async function sweepAccount(
  db: Db,
  accountId: string,
  window: ReturnType<typeof sweepWindow>
): Promise<AccountSweepResult> {
  const base: AccountSweepResult = {
    accountId,
    status: 'completed',
    threadsSeen: 0,
    threadsAnalyzed: 0,
    factsApplied: 0,
    factsProposed: 0,
    gapsOpened: 0,
    digestSent: false,
  };

  // ── 1. Claim ─────────────────────────────────────────────
  const { data: claim, error: claimErr } = await db
    .from('conversation_sweep_runs')
    .insert({
      account_id: accountId,
      run_date: window.runDate,
      window_start: window.start.toISOString(),
      window_end: window.end.toISOString(),
      status: 'running',
    })
    .select('id')
    .maybeSingle();

  if (claimErr || !claim) {
    // The unique index refused it: this morning is already done or in
    // flight. That is the mechanism working, not a failure.
    return { ...base, status: 'skipped', detail: 'already claimed' };
  }
  const runId = (claim as { id: string }).id;

  const finish = async (result: AccountSweepResult) => {
    await db
      .from('conversation_sweep_runs')
      .update({
        status: result.status === 'failed' ? 'failed' : 'completed',
        detail: result.detail ?? null,
        threads_seen: result.threadsSeen,
        threads_analyzed: result.threadsAnalyzed,
        facts_applied: result.factsApplied,
        facts_proposed: result.factsProposed,
        gaps_opened: result.gapsOpened,
        credits_burned: result.threadsAnalyzed * AI_FEATURE_COSTS[AI_FEATURE],
      })
      .eq('id', runId);
    return result;
  };

  try {
    // ── 2. Read and detect — free ──────────────────────────
    const [clientThreads, personalThreads] = await Promise.all([
      collectClientThreads(db, accountId, window),
      collectPersonalThreads(db, accountId, window),
    ]);
    const threads = [...clientThreads, ...personalThreads].slice(
      0,
      MAX_THREADS_PER_ACCOUNT
    );
    base.threadsSeen = threads.length;

    if (!threads.length) {
      return finish({ ...base, status: 'completed', detail: 'no activity' });
    }

    const contexts = await collectContexts(db, accountId, threads, window);
    const empty: ThreadContext = {
      hasOpenDeal: false,
      hasFutureAppointment: false,
      hasOpenTodo: false,
      repliedAfterWindow: false,
      hasStatedRequirement: false,
      hasSharedAnyProperty: false,
    };

    const perThreadGaps = new Map<string, ReturnType<typeof detectGaps>>();
    for (const thread of threads) {
      const ctx = contexts.get(threadKey(thread)) ?? empty;
      perThreadGaps.set(threadKey(thread), detectGaps(thread, ctx, window.end));
    }

    // ── 3. Analyse — paid, and stops when the money does ───
    let analyzed = 0;
    let outOfCredits = false;

    for (const thread of threads) {
      if (analyzed >= MAX_ANALYZED_PER_ACCOUNT || outOfCredits) break;

      // The free gate, BEFORE the burn. A thread with nothing said in
      // it — a run of outbound listing blasts, a single template
      // nobody answered — has no language to read, and paying to read
      // it is how the first production run spent 42 credits on 14
      // threads and came back with a buyer's budget copied off a
      // listing we had sent him.
      if (!worthAnalyzing(thread)) continue;

      const burn = await burnCredits(
        accountId,
        AI_FEATURE,
        AI_FEATURE_COSTS[AI_FEATURE],
        {
          // One burn per thread per morning. The retry key is what makes
          // a resumed run charge once for a thread it already read.
          retryKey: `sweep:${window.runDate}:${threadKey(thread)}`,
        }
      ).catch(() => ({ success: false, balanceAfter: 0, deficit: 0 }));

      if (!burn.success) {
        outOfCredits = true;
        break;
      }

      const findings = await analyzeThread(thread);
      if (!findings.analyzed) continue;
      analyzed += 1;

      const facts = await applyFacts(db, accountId, thread, findings.facts);
      base.factsApplied += facts.applied;
      base.factsProposed += facts.proposed;

      const key = threadKey(thread);
      perThreadGaps.set(key, [
        ...(perThreadGaps.get(key) ?? []),
        ...findings.gaps,
      ]);
    }
    base.threadsAnalyzed = analyzed;

    // ── 4. File and report ─────────────────────────────────
    for (const thread of threads) {
      const gaps = perThreadGaps.get(threadKey(thread)) ?? [];
      if (!gaps.length) continue;
      const persisted = await persistGaps({ db, accountId, thread, gaps });
      base.gapsOpened += persisted.opened;
    }

    const holder = await accountHolder(db, accountId);
    if (holder) {
      base.digestSent = await sendSweepDigest({
        accountId,
        userId: holder,
        input: {
          gaps: await openGapsFor(db, accountId),
          factsApplied: base.factsApplied,
          factsProposed: base.factsProposed,
          threadsAnalyzed: base.threadsAnalyzed,
        },
      });
    }

    return finish({
      ...base,
      detail: outOfCredits ? 'analysis stopped: out of credits' : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sweep] account ${accountId} failed:`, message);
    return finish({ ...base, status: 'failed', detail: message });
  }
}

export interface SweepRunSummary {
  runDate: string;
  accounts: number;
  completed: number;
  skipped: number;
  failed: number;
  gapsOpened: number;
  factsApplied: number;
  factsProposed: number;
  digestsSent: number;
}

/**
 * The whole platform's morning.
 *
 * Sequential across accounts on purpose: each account's work is a
 * handful of queries plus up to 25 model calls, and running them all
 * at once would put the whole platform's Gemini traffic into one
 * burst against a quota shared with the live chatbot — which is
 * serving people who are waiting.
 */
export async function runConversationSweep(
  now = new Date()
): Promise<SweepRunSummary> {
  const db = supabaseAdmin();
  const window = sweepWindow(now);

  const summary: SweepRunSummary = {
    runDate: window.runDate,
    accounts: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    gapsOpened: 0,
    factsApplied: 0,
    factsProposed: 0,
    digestsSent: 0,
  };

  if (!boundaryHasPassed(now)) return summary;

  const accounts = await activeAccounts(db, window);
  summary.accounts = accounts.length;

  for (const accountId of accounts) {
    const result = await sweepAccount(db, accountId, window);
    if (result.status === 'completed') summary.completed += 1;
    else if (result.status === 'skipped') summary.skipped += 1;
    else summary.failed += 1;

    summary.gapsOpened += result.gapsOpened;
    summary.factsApplied += result.factsApplied;
    summary.factsProposed += result.factsProposed;
    if (result.digestSent) summary.digestsSent += 1;
  }

  return summary;
}
