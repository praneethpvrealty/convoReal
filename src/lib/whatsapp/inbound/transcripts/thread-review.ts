// ============================================================
// Nightly bot thread review — every conversation the bot wrote in
// during the last day, read back as a whole thread.
//
// Two readers, in order. The transcript rules (transcript-rules.ts)
// are deterministic and free: a bot burst, a contradictory arrival, a
// dead end with nowhere to browse. The model then scores what rules
// cannot see — whether the thread answered what the lead asked, in
// the right tone, with a next step. A thread fails on either.
//
// One row per conversation per IST day (UNIQUE), checked before the
// model is called, so a rerun costs nothing. Best-effort per thread:
// one bad thread never aborts the run.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson } from '@/lib/ai/gemini';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  checkTranscript,
  transcriptFromMessages,
  type TranscriptMessage,
  type TranscriptViolation,
} from './transcript-rules';
import { maskContactDetails } from './mask';

/** The floor for the very first run; from then on the scan starts at
 *  the earliest review on record, so nothing after the night the review
 *  went live ages out. A thread the budget left over tonight, or one a
 *  slow night missed, is picked up the next night ahead of newer
 *  threads: a conversation is reviewed whenever it has bot activity
 *  newer than its last review's window, oldest first. */
export const REVIEW_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Wall-clock budget for one invocation, under the route's maxDuration;
 *  a run that hits it reports so, and the next run picks up the rest. */
export const REVIEW_TIME_BUDGET_MS = 240_000;
export const MAX_THREADS_PER_RUN = 150;
/** A window is read from its first unreviewed bot message: at most this
 *  many bubbles leading up to and including it, then what followed,
 *  under the cap. The watermark is the newest bot bubble actually read,
 *  so whatever the cap leaves out is still due and opens the next
 *  window. */
export const MAX_MESSAGES_PER_THREAD = 60;
export const REVIEW_LEAD_IN_MESSAGES = 20;
/** Bubbles from before the window, carried in as context so a rule
 *  that spans windows (the listing already said to be unavailable) and
 *  the judge both read the thread, never reported on again. */
export const REVIEW_CONTEXT_MESSAGES = 10;
/** A claim this old with no judged_at was left by a run that died
 *  mid-judge; the next run takes it over. Well past the route's
 *  maxDuration, so a live run is never robbed of its claim. Kept in
 *  step with bot_thread_review_windows. */
export const CLAIM_STALE_MS = 15 * 60 * 1000;
export const PASS_SCORE = 70;
export const REVIEW_MODEL = 'gemini:lite';

export type ReviewVerdict = 'pass' | 'fail' | 'unscored';

export interface ModelIssue {
  kind: string;
  message_index: number | null;
  note: string;
}

export interface ThreadReview {
  accountId: string;
  conversationId: string;
  contactId: string | null;
  reviewDay: string;
  windowStart: string;
  windowEnd: string;
  transcript: TranscriptMessage[];
  ruleViolations: TranscriptViolation[];
  score: number | null;
  verdict: ReviewVerdict;
  issues: ModelIssue[];
  summary: string | null;
}

export interface ReviewRunResult {
  threads: number;
  reviewed: number;
  skipped: number;
  failed: number;
  verdicts: Record<ReviewVerdict, number>;
  /** True when the time budget ended the run before the window was
   *  covered; the remainder waits for the next run. */
  budgetExhausted: boolean;
}

const JUDGE_SYSTEM = [
  'You review WhatsApp conversations between a real-estate brokerage bot and a property buyer in India.',
  'Read the whole thread as the buyer did. Score it from 0 to 100 and list concrete issues.',
  'Fail-worthy issues: the bot contradicts itself between bubbles; repeats a point it already made; promises properties and shows none; answers a tapped button with something else; sends more bubbles than the buyer wrote for; praises itself; greets a new lead as if they had been away; leaves the buyer with no next step and no link to browse; is rude, pushy or confusing.',
  'Do not penalise a template message for its fixed wording, a short acknowledgement, or a legitimate "nothing fits yet" that names alternatives or a link.',
  'Bubbles marked (context) were reviewed before: read them to judge the ones that follow, and do not score or list issues on them.',
  'Reply with JSON only: {"score": <0-100>, "summary": "<one sentence>", "issues": [{"kind": "<contradiction|repetition|promise-unkept|wrong-answer|too-many-bubbles|self-praise|wrong-greeting|dead-end|tone|other>", "message_index": <index of the bubble or null>, "note": "<what is wrong, in one sentence>"}]}',
].join(' ');

function ist(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function buildJudgePrompt(
  transcript: TranscriptMessage[],
  context: { contactCreatedAt: string | null; now: string }
): string {
  const lines = transcript.map(
    (m, i) =>
      `[${i}] ${m.sender.toUpperCase()}${m.kind === 'template' ? ' (template)' : m.kind === 'interactive' ? ' (interactive)' : ''}${m.context ? ' (context)' : ''}${m.at ? ` @ ${m.at}` : ''}:\n${maskContactDetails(m.text)}`
  );
  return [
    `Lead created: ${context.contactCreatedAt ?? 'unknown'}. Reviewed at: ${context.now}.`,
    'Thread:',
    ...lines,
  ].join('\n\n');
}

export function parseJudgeReply(raw: string): {
  score: number | null;
  summary: string | null;
  issues: ModelIssue[];
} {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      score?: unknown;
      summary?: unknown;
      issues?: unknown;
    };
    const score =
      typeof parsed.score === 'number' && Number.isFinite(parsed.score)
        ? Math.max(0, Math.min(100, Math.round(parsed.score)))
        : null;
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .filter(
            (issue): issue is Record<string, unknown> =>
              !!issue && typeof issue === 'object'
          )
          .map((issue) => ({
            kind:
              typeof issue.kind === 'string'
                ? issue.kind.slice(0, 40)
                : 'other',
            message_index:
              typeof issue.message_index === 'number'
                ? issue.message_index
                : null,
            note:
              typeof issue.note === 'string' ? issue.note.slice(0, 400) : '',
          }))
          .slice(0, 12)
      : [];
    return {
      score,
      summary:
        typeof parsed.summary === 'string'
          ? parsed.summary.slice(0, 400)
          : null,
      issues,
    };
  } catch {
    return { score: null, summary: null, issues: [] };
  }
}

export function decideVerdict(
  ruleViolations: TranscriptViolation[],
  score: number | null
): ReviewVerdict {
  if (ruleViolations.length > 0) return 'fail';
  if (score === null) return 'unscored';
  return score < PASS_SCORE ? 'fail' : 'pass';
}

export async function reviewThread(args: {
  transcript: TranscriptMessage[];
  contactCreatedAt: string | null;
  now: Date;
  judge?: (prompt: string, system: string) => Promise<string>;
}): Promise<{
  ruleViolations: TranscriptViolation[];
  score: number | null;
  verdict: ReviewVerdict;
  issues: ModelIssue[];
  summary: string | null;
}> {
  const ruleViolations = checkTranscript(args.transcript, {
    contactCreatedAt: args.contactCreatedAt,
  });
  const judge =
    args.judge ??
    ((prompt: string, system: string) =>
      generateJson(prompt, system, {
        tier: 'lite',
        feature: 'bot_thread_review',
        maxOutputTokens: 800,
      }));
  // A judge that throws (quota, network) propagates: the caller releases
  // its claim so the thread is retried the next night rather than
  // recorded unscored. A reply without a score is an answer, and stays.
  const judged = parseJudgeReply(
    await judge(
      buildJudgePrompt(args.transcript, {
        contactCreatedAt: args.contactCreatedAt,
        now: args.now.toISOString(),
      }),
      JUDGE_SYSTEM
    )
  );
  return {
    ruleViolations,
    score: judged.score,
    verdict: decideVerdict(ruleViolations, judged.score),
    issues: judged.issues,
    summary: judged.summary,
  };
}

interface MessageRow {
  conversation_id: string;
  account_id: string | null;
  sender_type: string | null;
  content_type: string | null;
  content_text: string | null;
  template_name: string | null;
  created_at: string;
}

export interface ReviewCandidate {
  conversationId: string;
  accountId: string | null;
  /** Where this window starts: the conversation's last review
   *  boundary, or the floor for a conversation never reviewed. */
  fromAt: string;
  /** The first bot message after it; the window is read from here, so
   *  a thread picked up nights later is still read around its own
   *  exchange. */
  firstBotAt: string;
}

/**
 * Conversations due a review: bot activity since `since` newer than
 * their last review's window, oldest due first so what one night left
 * over goes ahead of the next day's traffic, aggregated in SQL
 * (bot_thread_review_windows) so there is no page ceiling to age a
 * thread out behind. Private rows are staff notes and failed
 * deliveries never reached the lead; neither counts.
 */
export async function collectBotThreads(
  db: SupabaseClient,
  since: Date,
  limit = MAX_THREADS_PER_RUN,
  /** Conversations this run already reviewed or gave up on; never
   *  collected twice (a reviewed one is due again only tomorrow, the
   *  day's row being unique). */
  exclude: ReadonlySet<string> = new Set()
): Promise<ReviewCandidate[]> {
  const { data, error } = await db.rpc('bot_thread_review_windows', {
    p_since: since.toISOString(),
    p_limit: limit,
    p_exclude: [...exclude],
  });
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as {
      conversation_id: string;
      account_id: string | null;
      from_at: string;
      first_bot_at: string;
    }[]
  ).map((row) => ({
    conversationId: row.conversation_id,
    accountId: row.account_id,
    fromAt: row.from_at,
    firstBotAt: row.first_bot_at,
  }));
}

export async function runBotThreadReview(
  options: {
    db?: SupabaseClient;
    now?: Date;
    /** Conversations collected per batch; the run continues in batches
     *  until the window is covered or the time budget is spent. */
    limit?: number;
    budgetMs?: number;
    judge?: (prompt: string, system: string) => Promise<string>;
  } = {}
): Promise<ReviewRunResult> {
  const db = options.db ?? supabaseAdmin();
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? REVIEW_TIME_BUDGET_MS;
  const reviewDay = ist(now);
  const result: ReviewRunResult = {
    threads: 0,
    reviewed: 0,
    skipped: 0,
    failed: 0,
    verdicts: { pass: 0, fail: 0, unscored: 0 },
    budgetExhausted: false,
  };

  const handled = new Set<string>();
  for (;;) {
    if (Date.now() - startedAt >= budgetMs) {
      result.budgetExhausted = true;
      break;
    }
    const threads = await collectBotThreads(
      db,
      new Date(now.getTime() - REVIEW_LOOKBACK_MS),
      options.limit ?? MAX_THREADS_PER_RUN,
      handled
    );
    if (threads.length === 0) break;
    result.threads += threads.length;

    for (const thread of threads) {
      if (Date.now() - startedAt >= budgetMs) {
        result.budgetExhausted = true;
        break;
      }
      try {
        const { data: conversation } = await db
          .from('conversations')
          .select('id, account_id, contact_id')
          .eq('id', thread.conversationId)
          .maybeSingle();
        const accountId =
          (conversation as { account_id?: string } | null)?.account_id ??
          thread.accountId;
        if (!conversation || !accountId) {
          result.skipped += 1;
          handled.add(thread.conversationId);
          continue;
        }
        const contactId =
          (conversation as { contact_id?: string | null }).contact_id ?? null;
        const visible = () =>
          db
            .from('messages')
            .select(
              'conversation_id, account_id, sender_type, content_type, content_text, template_name, created_at'
            )
            .eq('conversation_id', thread.conversationId)
            .eq('private', false)
            .neq('status', 'failed');
        // The window is the thread since its last review, read from its
        // first unreviewed bot message: a bounded lead-up to and
        // including that message, newest first and restored to reading
        // order below, then what followed under the cap. A few bubbles
        // from before the window come along as context.
        const [
          { data: before, error: beforeError },
          { data: leadIn, error: leadInError },
          { data: rest, error: restError },
          { data: contact, error: contactError },
        ] = await Promise.all([
          visible()
            .lte('created_at', thread.fromAt)
            .order('created_at', { ascending: false })
            .limit(REVIEW_CONTEXT_MESSAGES),
          visible()
            .gt('created_at', thread.fromAt)
            .lte('created_at', thread.firstBotAt)
            .order('created_at', { ascending: false })
            .limit(REVIEW_LEAD_IN_MESSAGES),
          visible()
            .gt('created_at', thread.firstBotAt)
            .order('created_at', { ascending: true })
            .limit(MAX_MESSAGES_PER_THREAD - REVIEW_LEAD_IN_MESSAGES),
          contactId
            ? db
                .from('contacts')
                .select('id, created_at')
                .eq('id', contactId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        // A partial read is never finalised: the thread fails tonight
        // and is still due tomorrow.
        const readError =
          beforeError ?? leadInError ?? restError ?? contactError;
        if (readError) throw new Error(readError.message);
        const rows = [
          ...[...((leadIn ?? []) as MessageRow[])].reverse(),
          ...((rest ?? []) as MessageRow[]),
        ];
        const transcript = [
          ...transcriptFromMessages(
            [...((before ?? []) as MessageRow[])].reverse()
          ).map((m) => ({ ...m, context: true })),
          ...transcriptFromMessages(rows),
        ];
        // The watermark is the newest bot bubble actually read: nothing
        // the cap left out is counted as covered, so it opens the next
        // window instead.
        const windowEnd = rows
          .filter((row) => row.sender_type === 'bot')
          .map((row) => row.created_at)
          .sort()
          .at(-1);
        if (!windowEnd) {
          result.skipped += 1;
          handled.add(thread.conversationId);
          continue;
        }
        const contactCreatedAt =
          (contact as { created_at?: string } | null)?.created_at ?? null;

        // Claim the day's row before the model is called: the UNIQUE
        // constraint decides between overlapping runs, so the judge
        // runs once per conversation per day whichever run wins. A
        // claim a dead run left behind is taken over first.
        const ruleViolations = checkTranscript(transcript, {
          contactCreatedAt,
        });
        const claim = {
          account_id: accountId,
          conversation_id: thread.conversationId,
          contact_id: contactId,
          review_day: reviewDay,
          window_start: thread.fromAt,
          window_end: windowEnd,
          transcript,
          rule_violations: ruleViolations,
          score: null,
          verdict: decideVerdict(ruleViolations, null),
          issues: [],
          summary: null,
          model: REVIEW_MODEL,
          reviewed_at: new Date().toISOString(),
          judged_at: null,
        };
        const { data: reclaimed, error: reclaimError } = await db
          .from('bot_thread_reviews')
          .update(claim)
          .eq('conversation_id', thread.conversationId)
          .is('judged_at', null)
          .lt(
            'reviewed_at',
            new Date(Date.now() - CLAIM_STALE_MS).toISOString()
          )
          .select('id');
        let claimedId = (reclaimed as { id: string }[] | null)?.[0]?.id;
        let claimError = reclaimError;
        if (!claimedId && !claimError) {
          const { data: inserted, error } = await db
            .from('bot_thread_reviews')
            .insert(claim)
            .select('id')
            .single();
          claimedId = (inserted as { id: string } | null)?.id;
          claimError = error;
        }
        if (claimError || !claimedId) {
          if (claimError?.code === '23505') {
            result.skipped += 1;
            handled.add(thread.conversationId);
            continue;
          }
          throw new Error(claimError?.message ?? 'claim failed');
        }

        try {
          const review = await reviewThread({
            transcript,
            contactCreatedAt,
            now,
            judge: options.judge,
          });
          const judgedAt = new Date().toISOString();
          const { error: updateError } = await db
            .from('bot_thread_reviews')
            .update({
              score: review.score,
              verdict: review.verdict,
              issues: review.issues,
              summary: review.summary,
              reviewed_at: judgedAt,
              judged_at: judgedAt,
            })
            .eq('id', claimedId)
            .select('id');
          if (updateError) throw new Error(updateError.message);
          result.reviewed += 1;
          result.verdicts[review.verdict] += 1;
          handled.add(thread.conversationId);
        } catch (err) {
          // Release the claim so the next night retries instead of
          // reading this row as the thread's last review.
          await db.from('bot_thread_reviews').delete().eq('id', claimedId);
          throw err;
        }
      } catch (err) {
        result.failed += 1;
        handled.add(thread.conversationId);
        console.error(
          `[bot-thread-review] conversation ${thread.conversationId} failed:`,
          err
        );
      }
    }
    if (result.budgetExhausted) break;
  }

  return result;
}
