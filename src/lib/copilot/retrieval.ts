import { CHUNKS, chunkVersion, type KnowledgeChunk } from './chunks';
import { KNOWLEDGE_INDEX } from './knowledge-index.gen';

/**
 * Chunk retrieval for the copilot prompt.
 *
 * The current page's chunk is always included (a bad match must never
 * leave the model blind about the screen the user is on); the rest of
 * the slots go to the top-scoring chunks for the question.
 *
 * Scoring is semantic when possible — cosine over the committed index
 * (knowledge-index.gen.ts), reusing the question embedding the Q&A
 * cache already paid for. A chunk whose index entry is missing or
 * stale, or a request with no embedding at all, scores lexically
 * instead: weighted token overlap against title, keywords and body.
 * Retrieval therefore degrades, never breaks, when the index lags the
 * corpus.
 */

export const TOP_K = 6;

const TOKEN_RE = /[\p{L}\p{N}]+/gu;
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'do',
  'does',
  'can',
  'i',
  'my',
  'me',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'it',
  'this',
  'that',
  'how',
  'what',
  'where',
  'when',
  'why',
  'you',
  'we',
  'from',
  'with',
  'kya',
  'hai',
  'kaise',
  'mera',
  'main',
  'ka',
  'ki',
  'ke',
  'ko',
  'se',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t)
  );
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Weighted token overlap in [0, 1): title and keyword hits count
 * triple, body hits single, normalised by question length so long
 * questions don't out-score short ones by volume.
 */
export function lexicalScore(question: string, chunk: KnowledgeChunk): number {
  const questionTokens = new Set(tokenize(question));
  if (questionTokens.size === 0) return 0;

  const strong = new Set([
    ...tokenize(chunk.title),
    ...(chunk.keywords ?? []).flatMap(tokenize),
  ]);
  const weak = new Set(tokenize(chunk.body));

  let score = 0;
  for (const token of questionTokens) {
    if (strong.has(token)) score += 3;
    else if (weak.has(token)) score += 1;
  }
  return score / (3 * questionTokens.size + 1);
}

function semanticScore(
  embedding: number[],
  chunk: KnowledgeChunk
): number | null {
  const entry = KNOWLEDGE_INDEX[chunk.id];
  if (!entry || entry.v !== chunkVersion(chunk)) return null;
  return cosineSimilarity(embedding, entry.embedding);
}

/** Longest-route-prefix page chunk for the pathname, if any. */
export function anchorChunkFor(pathname: string): KnowledgeChunk | null {
  let best: KnowledgeChunk | null = null;
  for (const chunk of CHUNKS) {
    if (chunk.kind !== 'page' || !chunk.route) continue;
    if (pathname !== chunk.route && !pathname.startsWith(chunk.route + '/'))
      continue;
    if (!best || chunk.route.length > best.route!.length) best = chunk;
  }
  return best;
}

export interface RetrievalInput {
  pathname: string;
  message: string;
  /** Question embedding when one was computed; null falls back to
   *  lexical scoring for every chunk. */
  embedding: number[] | null;
}

/**
 * Anchor + top-K chunks for one question, in prompt order. Every
 * scoring path is deterministic for a given corpus/index, which is
 * what lets retrieval.test.ts pin expected results.
 */
export function selectChunks(input: RetrievalInput): KnowledgeChunk[] {
  const anchor = anchorChunkFor(input.pathname);
  const scored: { chunk: KnowledgeChunk; score: number }[] = [];

  for (const chunk of CHUNKS) {
    if (chunk === anchor) continue;
    const semantic = input.embedding
      ? semanticScore(input.embedding, chunk)
      : null;
    const score = semantic ?? lexicalScore(input.message, chunk);
    if (score <= 0) continue;
    scored.push({ chunk, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, TOP_K).map((s) => s.chunk);
  return anchor ? [anchor, ...selected] : selected;
}

/** {id, v} pairs recorded on cache rows for per-chunk invalidation. */
export function chunkRefs(
  chunks: KnowledgeChunk[]
): { id: string; v: string }[] {
  return chunks.map((c) => ({ id: c.id, v: chunkVersion(c) }));
}
