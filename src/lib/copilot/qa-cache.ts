import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isCurrentChunk, type Audience } from './chunks';
import { buildCopilotScaffold, isAllowedRoute } from './knowledge';
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
 * Staleness is two-tier. The KB version hashes the prompt scaffold
 * (rules, page directory, tours, contract): a scaffold change retires
 * everything, in SQL. Each row additionally records the knowledge
 * chunks its answer was built from as {id, v} pairs, validated here
 * against the live corpus — editing one chunk retires only the
 * answers that used it.
 *
 * The table is shared by all three audiences, and the KB version is
 * what keeps them apart: staff, owners and buyers have different
 * scaffolds, so their hashes differ and match_copilot_qa can never
 * hand an owner an answer written for an agent. That partitioning is
 * a property of the data, not of a filter someone has to remember.
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
 * Version stamp of the prompt scaffold an audience's answers were
 * generated under. Any change to that audience's rules, page
 * directory, tour registry, or output contract rotates its hash, and
 * match_copilot_qa stops returning rows written under the old
 * version — stale answers retire themselves with zero cleanup code.
 * Knowledge-chunk edits intentionally do NOT rotate it; those are
 * handled per-row via source_chunks validation below.
 */
export function kbVersionFor(audience: Audience): string {
  return createHash('sha256')
    .update(buildCopilotScaffold('/', audience))
    .digest('hex')
    .slice(0, 12);
}

/** Staff KB version — the original constant, unchanged. */
export const KB_VERSION = kbVersionFor('agent');

export interface ChunkRef {
  id: string;
  v: string;
}

export interface CachedAnswer {
  id: string;
  reply: string;
  tourId?: string;
  navigateTo?: string;
  /** Set when the cached answer was a "we don't do that" — the route
   *  re-logs the demand so cache hits keep counting (see unmet.ts). */
  unsupportedCapability?: string;
}

let _adminClient: SupabaseClient | null = null;
function cacheAdmin(): SupabaseClient | null {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
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
  historyLength: number
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
  unsupported_capability: string | null;
  source_chunks: ChunkRef[] | null;
  similarity: number;
}

/** Every chunk the answer was built from must still exist at the
 *  same version — one edited chunk retires the answer. */
function sourceChunksCurrent(refs: ChunkRef[] | null): boolean {
  if (!Array.isArray(refs)) return false;
  return refs.every(
    (r) =>
      !!r &&
      typeof r.id === 'string' &&
      typeof r.v === 'string' &&
      isCurrentChunk(r.id, r.v)
  );
}

/**
 * Searches for a validated cached answer by question embedding. The
 * caller embeds the question once and reuses the vector for chunk
 * retrieval and storeAnswer().
 */
export async function lookupCachedAnswer(
  embedding: number[],
  audience: Audience = 'agent'
): Promise<CachedAnswer | null> {
  const db = cacheAdmin();
  if (!db) return null;

  try {
    const { data, error } = await db.rpc('match_copilot_qa', {
      p_embedding: embedding,
      p_kb_version: kbVersionFor(audience),
      p_threshold: SIMILARITY_THRESHOLD,
      p_count: MATCH_COUNT,
    });
    if (error) throw new Error(error.message);

    // SQL already filtered version/age/votes/similarity; re-validate
    // the actions and source chunks against the live registries (a
    // tour, route, or chunk can change between deploys).
    for (const row of (data ?? []) as MatchRow[]) {
      const tourOk = !row.tour_id || !!getTour(row.tour_id);
      const routeOk =
        !row.navigate_to || isAllowedRoute(row.navigate_to, audience);
      if (!tourOk || !routeOk || !sourceChunksCurrent(row.source_chunks))
        continue;
      return {
        id: row.id,
        reply: row.reply,
        ...(row.tour_id ? { tourId: row.tour_id } : {}),
        ...(row.navigate_to ? { navigateTo: row.navigate_to } : {}),
        ...(row.unsupported_capability
          ? { unsupportedCapability: row.unsupported_capability }
          : {}),
      };
    }
    return null;
  } catch (err) {
    // Expected pre-migration (table/RPC missing) — fall through.
    console.warn(
      '[Copilot cache] lookup failed:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Fire-and-forget usage accounting for a served hit. */
export function bumpHit(id: string): void {
  const db = cacheAdmin();
  if (!db) return;
  void db.rpc('bump_copilot_qa_hit', { p_id: id }).then(({ error }) => {
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
  unsupportedCapability?: string;
  sourceChunks: ChunkRef[];
  audience?: Audience;
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
        unsupported_capability: input.unsupportedCapability ?? null,
        source_chunks: input.sourceChunks,
        kb_version: kbVersionFor(input.audience ?? 'agent'),
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  } catch (err) {
    console.warn(
      '[Copilot cache] store failed:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Atomic 👍/👎. Enough 👎 retires the entry (match_copilot_qa filter). */
export async function recordFeedback(
  id: string,
  vote: 'up' | 'down'
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
    console.warn(
      '[Copilot cache] feedback failed:',
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
