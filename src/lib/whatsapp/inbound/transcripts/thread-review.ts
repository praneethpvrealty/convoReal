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

/** Two hours past a day, so a run that starts late still overlaps the
 *  previous one; the per-day claim makes the overlap free. */
export const REVIEW_LOOKBACK_MS = 26 * 60 * 60 * 1000;
/** Wall-clock budget for one invocation, under the route's maxDuration;
 *  a run that hits it reports so, and the next run picks up the rest. */
export const REVIEW_TIME_BUDGET_MS = 240_000;
/** Context before the day's first bot message, so a tap is read with
 *  the arrival it answers. */
export const REVIEW_WINDOW_MS = 36 * 60 * 60 * 1000;
export const MAX_THREADS_PER_RUN = 150;
export const MAX_MESSAGES_PER_THREAD = 60;
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
  'Reply with JSON only: {"score": <0-100>, "summary": "<one sentence>", "issues": [{"kind": "<contradiction|repetition|promise-unkept|wrong-answer|too-many-bubbles|self-praise|wrong-greeting|dead-end|tone|other>", "message_index": <index of the bubble or null>, "note": "<what is wrong, in one sentence>"}]}',
].join(' ');

function ist(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function stripContactDetails(text: string): string {
  return text
    .replace(/(?:\+?\d[\s-]?){10,}/g, '[number]')
    .replace(/\S+@\S+\.\S+/g, '[email]');
}

export function buildJudgePrompt(
  transcript: TranscriptMessage[],
  context: { contactCreatedAt: string | null; now: string }
): string {
  const lines = transcript.map(
    (m, i) =>
      `[${i}] ${m.sender.toUpperCase()}${m.kind === 'template' ? ' (template)' : m.kind === 'interactive' ? ' (interactive)' : ''}${m.at ? ` @ ${m.at}` : ''}:\n${stripContactDetails(m.text)}`
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
  let judged: ReturnType<typeof parseJudgeReply> = {
    score: null,
    summary: null,
    issues: [],
  };
  try {
    const judge =
      args.judge ??
      ((prompt: string, system: string) =>
        generateJson(prompt, system, {
          tier: 'lite',
          feature: 'bot_thread_review',
          maxOutputTokens: 800,
        }));
    judged = parseJudgeReply(
      await judge(
        buildJudgePrompt(args.transcript, {
          contactCreatedAt: args.contactCreatedAt,
          now: args.now.toISOString(),
        }),
        JUDGE_SYSTEM
      )
    );
  } catch (err) {
    console.error('[bot-thread-review] judge failed:', err);
  }
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

export const COLLECT_PAGE_SIZE = 1000;

/**
 * Conversations the bot wrote to since `since` that have no review for
 * `reviewDay` yet, newest activity first. Pages through the bot's
 * messages until `limit` such conversations are found or the window is
 * exhausted, so a backlog beyond one night's cap is reached by the
 * next run rather than hidden behind the newest threads forever.
 * Private rows are staff notes, not bubbles the lead received.
 */
export async function collectBotThreads(
  db: SupabaseClient,
  since: Date,
  reviewDay: string,
  limit = MAX_THREADS_PER_RUN,
  pageSize = COLLECT_PAGE_SIZE,
  /** Conversations this run already gave up on; never collected twice. */
  exclude: ReadonlySet<string> = new Set()
): Promise<Array<{ conversationId: string; accountId: string | null }>> {
  const { data: reviewed, error: reviewedError } = await db
    .from('bot_thread_reviews')
    .select('conversation_id')
    .eq('review_day', reviewDay);
  if (reviewedError) throw new Error(reviewedError.message);
  const done = new Set(
    ((reviewed ?? []) as { conversation_id: string }[]).map(
      (row) => row.conversation_id
    )
  );
  const seen = new Map<string, string | null>();
  for (let from = 0; seen.size < limit; from += pageSize) {
    const { data, error } = await db
      .from('messages')
      .select('conversation_id, account_id, created_at')
      .eq('sender_type', 'bot')
      .eq('private', false)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Pick<
      MessageRow,
      'conversation_id' | 'account_id'
    >[];
    for (const row of page) {
      if (
        done.has(row.conversation_id) ||
        exclude.has(row.conversation_id) ||
        seen.has(row.conversation_id)
      )
        continue;
      seen.set(row.conversation_id, row.account_id);
      if (seen.size >= limit) break;
    }
    if (page.length < pageSize) break;
  }
  return [...seen].map(([conversationId, accountId]) => ({
    conversationId,
    accountId,
  }));
}

export async function runBotThreadReview(
  options: {
    db?: SupabaseClient;
    now?: Date;
    /** Conversations collected per batch; the run continues in batches
     *  until the window is covered or the time budget is spent. */
    limit?: number;
    pageSize?: number;
    budgetMs?: number;
    judge?: (prompt: string, system: string) => Promise<string>;
  } = {}
): Promise<ReviewRunResult> {
  const db = options.db ?? supabaseAdmin();
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? REVIEW_TIME_BUDGET_MS;
  const reviewDay = ist(now);
  const windowStart = new Date(now.getTime() - REVIEW_WINDOW_MS);
  const result: ReviewRunResult = {
    threads: 0,
    reviewed: 0,
    skipped: 0,
    failed: 0,
    verdicts: { pass: 0, fail: 0, unscored: 0 },
    budgetExhausted: false,
  };

  const givenUp = new Set<string>();
  for (;;) {
    if (Date.now() - startedAt >= budgetMs) {
      result.budgetExhausted = true;
      break;
    }
    const threads = await collectBotThreads(
      db,
      new Date(now.getTime() - REVIEW_LOOKBACK_MS),
      reviewDay,
      options.limit ?? MAX_THREADS_PER_RUN,
      options.pageSize,
      givenUp
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
          givenUp.add(thread.conversationId);
          continue;
        }
        const contactId =
          (conversation as { contact_id?: string | null }).contact_id ?? null;

        const [{ data: rows }, { data: contact }] = await Promise.all([
          db
            .from('messages')
            .select(
              'conversation_id, account_id, sender_type, content_type, content_text, template_name, created_at'
            )
            .eq('conversation_id', thread.conversationId)
            .eq('private', false)
            .is('deleted_at', null)
            .gte('created_at', windowStart.toISOString())
            // Newest first under the cap, so a long thread keeps the
            // exchange that put it on tonight's list; restored to
            // reading order below.
            .order('created_at', { ascending: false })
            .limit(MAX_MESSAGES_PER_THREAD),
          contactId
            ? db
                .from('contacts')
                .select('id, created_at')
                .eq('id', contactId)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        const transcript = transcriptFromMessages(
          [...((rows ?? []) as MessageRow[])].reverse()
        );
        if (!transcript.some((m) => m.sender === 'bot')) {
          result.skipped += 1;
          givenUp.add(thread.conversationId);
          continue;
        }
        const contactCreatedAt =
          (contact as { created_at?: string } | null)?.created_at ?? null;

        // Claim the day's row before the model is called: the UNIQUE
        // constraint decides between overlapping runs, so the judge
        // runs once per conversation per day whichever run wins.
        const ruleViolations = checkTranscript(transcript, {
          contactCreatedAt,
        });
        const { data: claimed, error: claimError } = await db
          .from('bot_thread_reviews')
          .insert({
            account_id: accountId,
            conversation_id: thread.conversationId,
            contact_id: contactId,
            review_day: reviewDay,
            window_start: windowStart.toISOString(),
            window_end: now.toISOString(),
            transcript,
            rule_violations: ruleViolations,
            score: null,
            verdict: decideVerdict(ruleViolations, null),
            issues: [],
            summary: null,
            model: REVIEW_MODEL,
          })
          .select('id')
          .single();
        if (claimError || !claimed) {
          if (claimError?.code === '23505') {
            result.skipped += 1;
            givenUp.add(thread.conversationId);
            continue;
          }
          throw new Error(claimError?.message ?? 'claim failed');
        }

        const review = await reviewThread({
          transcript,
          contactCreatedAt,
          now,
          judge: options.judge,
        });
        const { error: updateError } = await db
          .from('bot_thread_reviews')
          .update({
            score: review.score,
            verdict: review.verdict,
            issues: review.issues,
            summary: review.summary,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', (claimed as { id: string }).id)
          .select('id');
        if (updateError) throw new Error(updateError.message);
        result.reviewed += 1;
        result.verdicts[review.verdict] += 1;
      } catch (err) {
        result.failed += 1;
        givenUp.add(thread.conversationId);
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
