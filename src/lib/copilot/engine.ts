import { embedText, generateJson } from '@/lib/ai/gemini';
import type { Audience } from './chunks';
import { cannedTourReply, matchTourIntent } from './intent';
import { buildCopilotSystemPrompt, isAllowedRoute } from './knowledge';
import {
  bumpHit,
  isCacheableQuestion,
  lookupCachedAnswer,
  storeAnswer,
} from './qa-cache';
import { chunkRefs, selectChunks } from './retrieval';
import { getTour } from './tours';
import { logUnmetRequest, sanitizeCapability } from './unmet';

/**
 * The helper's answer engine, shared by all three surfaces: the staff
 * dashboard (/api/copilot), the owner Portfolio (/api/den/copilot) and
 * the buyer Portfolio (/api/buyer/copilot).
 *
 * Each route does its own authentication — staff resolve an account,
 * portals resolve a Den/Buyer context — and then hands the audience
 * and an account to attribute demand to. Everything downstream (cost
 * control, retrieval, caching, unmet-request logging) is identical,
 * and lives here rather than in three copies that would drift.
 *
 * Cost control is structural, in this order:
 *  1. the deterministic tour matcher answers the most common staff
 *     "how do I X?" questions with ZERO model calls (staff only —
 *     tours spotlight dashboard elements that no portal has),
 *  2. the shared semantic cache answers anything asked before, and
 *  3. only genuinely novel questions reach Gemini.
 * Rate limits are the caller's job — they differ per surface.
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AnswerRequest {
  audience: Audience;
  message: string;
  pathname: string;
  history: ChatTurn[];
  /** Account the unmet-request demand is attributed to. Null for a
   *  portal user with no agency link yet — demand is skipped, not
   *  guessed at. */
  accountId: string | null;
}

export interface AnswerResult {
  reply: string;
  tourId?: string;
  navigateTo?: string;
  unsupported?: true;
  cached?: true;
  cacheId?: string;
}

const NO_AI_REPLY: Record<Audience, string> = {
  agent:
    'I can walk you through things step by step — tap one of the guides below! (AI answers are not set up on this server yet.)',
  owner:
    'I can’t answer questions on this server yet — your agent is the fastest way to get help with your property.',
  buyer:
    'I can’t answer questions on this server yet — the agent handling a property is the fastest way to get help.',
};

/** Gemini JSON mode still occasionally wraps output in ``` fences. */
function parseModelJson(raw: string): {
  reply?: unknown;
  tourId?: unknown;
  navigateTo?: unknown;
  unsupported?: unknown;
} | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function answerQuestion(
  req: AnswerRequest
): Promise<AnswerResult> {
  const { audience, message, pathname, history, accountId } = req;

  const logUnmet = (capability: string | undefined | null) => {
    const clean = sanitizeCapability(capability);
    if (!clean || !accountId) return false;
    logUnmetRequest({
      accountId,
      capability: clean,
      question: message,
      pathname,
      audience,
    });
    return true;
  };

  // Deterministic short-circuit — zero Gemini calls for tour asks.
  // Staff only: a tour drives the dashboard UI, which portals lack.
  if (audience === 'agent') {
    const tourId = matchTourIntent(message);
    if (tourId) {
      return { reply: cannedTourReply(getTour(tourId)!.title), tourId };
    }
  }

  // Helper still works on deployments without a Gemini key.
  if (!process.env.GEMINI_API_KEY) {
    return { reply: NO_AI_REPLY[audience] };
  }

  // One embed per request, reused three ways: cache lookup, chunk
  // retrieval, and (on a miss) storeAnswer. Best-effort — without it
  // the cache is skipped and retrieval scores lexically.
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(message);
  } catch (err) {
    console.warn(
      '[Copilot] embed failed:',
      err instanceof Error ? err.message : err
    );
  }

  // Self-learning cache: a similar generic question answered before
  // (for ANY user of this audience) is served from the learned store —
  // deterministic validation only, no Gemini call. Best-effort: every
  // cache failure falls through to the normal path below.
  const cacheable = isCacheableQuestion(message, history.length);
  if (cacheable && embedding) {
    const entry = await lookupCachedAnswer(embedding, audience);
    if (entry) {
      bumpHit(entry.id);
      // A cached "we don't do that" still counts as demand —
      // otherwise only the first user to ask is ever visible.
      const logged = logUnmet(entry.unsupportedCapability);
      return {
        reply: entry.reply,
        ...(entry.tourId ? { tourId: entry.tourId } : {}),
        ...(entry.navigateTo ? { navigateTo: entry.navigateTo } : {}),
        ...(logged ? { unsupported: true as const } : {}),
        cached: true as const,
        cacheId: entry.id,
      };
    }
  }

  const transcript = history
    .map((t) => `${t.role === 'user' ? 'User' : 'Helper'}: ${t.text}`)
    .join('\n');
  const prompt = transcript
    ? `${transcript}\nUser: ${message}`
    : `User: ${message}`;

  // Retrieval: current page's chunk + top-K for the question, the only
  // knowledge the model gets. Recorded on the cache row so a chunk
  // edit retires exactly the answers built on it.
  const chunks = selectChunks({ pathname, message, embedding, audience });

  const raw = await generateJson(
    prompt,
    buildCopilotSystemPrompt(pathname, chunks, audience),
    { feature: 'copilot' }
  );
  const parsed = parseModelJson(raw);

  const reply =
    parsed && typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.slice(0, 1000)
      : raw.slice(0, 1000);

  // Sanitize model-suggested actions against real registries — the
  // client must never receive a tour id or route we don't own.
  const safeTourId =
    audience === 'agent' &&
    parsed &&
    typeof parsed.tourId === 'string' &&
    getTour(parsed.tourId)
      ? parsed.tourId
      : undefined;
  const safeNavigate =
    parsed &&
    typeof parsed.navigateTo === 'string' &&
    isAllowedRoute(parsed.navigateTo, audience)
      ? parsed.navigateTo
      : undefined;

  // Unmet demand: the user asked for something the product can't do.
  const capability = parsed ? sanitizeCapability(parsed.unsupported) : null;
  const logged = logUnmet(capability?.capability);

  // Learn this answer: only clean, parseable replies to cacheable
  // questions enter the shared store (reuses the lookup embedding —
  // no second embed call).
  let cacheId: string | null = null;
  if (
    cacheable &&
    embedding &&
    parsed &&
    typeof parsed.reply === 'string' &&
    parsed.reply.trim()
  ) {
    cacheId = await storeAnswer({
      question: message,
      embedding,
      reply,
      tourId: safeTourId,
      navigateTo: safeNavigate,
      unsupportedCapability: capability?.capability,
      sourceChunks: chunkRefs(chunks),
      audience,
    });
  }

  return {
    reply,
    ...(safeTourId ? { tourId: safeTourId } : {}),
    ...(safeNavigate ? { navigateTo: safeNavigate } : {}),
    ...(logged ? { unsupported: true as const } : {}),
    ...(cacheId ? { cacheId } : {}),
  };
}
