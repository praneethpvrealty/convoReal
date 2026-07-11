import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/ai/gemini';
import { buildCopilotSystemPrompt, isAllowedRoute } from './knowledge';
import { getTour } from './tours';

/**
 * Self-learning Q&A cache for the copilot.
 *
 * Once Gemini answers a generic app question, the answer is stored
 * with a semantic embedding of the question (copilot_qa_cache,
 * migration 109). Similar questions from ANY user are then served
 * from the cache after deterministic validation — no second Gemini
 * call, ever, for the same question.
 *
 * Everything here is best-effort: any failure (table not migrated
 * yet, missing service key, embed error, network) resolves to null
 * and the caller falls through to the normal Gemini path. The cache
 * must never break chat.
 */

/** Cosine-similarity floor for serving a cached answer. Tuning:
 *  raise toward 0.95 if users report wrong answers being reused,
 *  lower toward 0.85 if the hit rate is disappointing. */
const SIMILARITY_THRESHOLD = 0.9;
/** Candidates fetched per lookup — the first one that passes
 *  app-side validation (tour/route still exist) is served. */
const MATCH_COUNT = 3;

/**
 * Version stamp of the app knowledge the answers were generated
 * from. Any change to PAGE_KNOWLEDGE, the tour registry, or the
 * prompt rules rotates this hash, and match_copilot_qa stops
 * returning rows written under the old version — stale answers
 * retire themselves with zero cleanup code.
 */
export const KB_VERSION = createHash('sha256')
  .update(buildCopilotSystemPrompt('/'))
  .digest('hex')
  .slice(0, 12);

export interface CachedAnswer {
  id: string;
  reply: string;
  tourId?: string;
  navigateTo?: string;
}

let _adminClient: SupabaseClient | null = null;
function cacheAdmin(): SupabaseClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }
  return _adminClient;
}

const EMAIL_RE = /\S+@\S+\.\S+/;
const LONG_DIGITS_RE = /\d{6,}/;

/**
 * The cache is GLOBAL across tenants, so only generic, context-free
 * app questions may enter it:
 *  - first turn only (follow-ups like "what about that?" depend on
 *    conversation history and must always go to Gemini), and
 *  - no PII markers (emails, phone-length digit runs).
 */
export function isCacheableQuestion(
  message: string,
  historyLength: number,
): boolean {
  if (historyLength > 0) return false;
  const text = message.trim();
  if (!text || text.length > 500) return false;
  if (EMAIL_RE.test(text) || LONG_DIGITS_RE.test(text)) return false;
  return true;
}

interface MatchRow {
  id: string;
  question: string;
  reply: string;
  tour_id: string | null;
  navigate_to: string | null;
  similarity: number;
}

/**
 * Embeds the question and searches for a validated cached answer.
 * Returns the embedding too so a subsequent storeAnswer() doesn't
 * pay for a second embed call.
 */
export async function lookupCachedAnswer(message: string): Promise<{
  entry: CachedAnswer | null;
  embedding: number[] | null;
}> {
  const db = cacheAdmin();
  if (!db) return { entry: null, embedding: null };

  let embedding: number[];
  try {
    embedding = await embedText(message);
  } catch (err) {
    console.warn('[Copilot cache] embed failed:', err instanceof Error ? err.message : err);
    return { entry: null, embedding: null };
  }

  try {
    const { data, error } = await db.rpc('match_copilot_qa', {
      p_embedding: embedding,
      p_kb_version: KB_VERSION,
      p_threshold: SIMILARITY_THRESHOLD,
      p_count: MATCH_COUNT,
    });
    if (error) throw new Error(error.message);

    // SQL already filtered version/age/votes/similarity; re-validate
    // the actions against the live registries (a tour or route can
    // disappear between deploys without a KB text change).
    for (const row of (data ?? []) as MatchRow[]) {
      const tourOk = !row.tour_id || !!getTour(row.tour_id);
      const routeOk = !row.navigate_to || isAllowedRoute(row.navigate_to);
      if (!tourOk || !routeOk) continue;
      return {
        entry: {
          id: row.id,
          reply: row.reply,
          ...(row.tour_id ? { tourId: row.tour_id } : {}),
          ...(row.navigate_to ? { navigateTo: row.navigate_to } : {}),
        },
        embedding,
      };
    }
    return { entry: null, embedding };
  } catch (err) {
    // Expected pre-migration (table/RPC missing) — fall through.
    console.warn('[Copilot cache] lookup failed:', err instanceof Error ? err.message : err);
    return { entry: null, embedding };
  }
}

/** Fire-and-forget usage accounting for a served hit. */
export function bumpHit(id: string): void {
  const db = cacheAdmin();
  if (!db) return;
  void db
    .rpc('bump_copilot_qa_hit', { p_id: id })
    .then(({ error }) => {
      if (error) console.warn('[Copilot cache] bump failed:', error.message);
    });
}

/** Writes a clean Gemini answer back to the cache. Returns the new
 *  row id (for client feedback) or null on any failure. */
export async function storeAnswer(input: {
  question: string;
  embedding: number[];
  reply: string;
  tourId?: string;
  navigateTo?: string;
}): Promise<string | null> {
  const db = cacheAdmin();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from('copilot_qa_cache')
      .insert({
        question: input.question,
        embedding: input.embedding,
        reply: input.reply,
        tour_id: input.tourId ?? null,
        navigate_to: input.navigateTo ?? null,
        kb_version: KB_VERSION,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  } catch (err) {
    console.warn('[Copilot cache] store failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Atomic 👍/👎. Enough 👎 retires the entry (match_copilot_qa filter). */
export async function recordFeedback(
  id: string,
  vote: 'up' | 'down',
): Promise<boolean> {
  const db = cacheAdmin();
  if (!db) return false;
  try {
    const { error } = await db.rpc('vote_copilot_qa', {
      p_id: id,
      p_up: vote === 'up',
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.warn('[Copilot cache] feedback failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
