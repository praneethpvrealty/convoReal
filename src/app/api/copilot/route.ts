import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { generateJson } from '@/lib/ai/gemini';
import { buildCopilotSystemPrompt, isAllowedRoute } from '@/lib/copilot/knowledge';
import { matchTourIntent, cannedTourReply } from '@/lib/copilot/intent';
import { getTour } from '@/lib/copilot/tours';
import {
  bumpHit,
  isCacheableQuestion,
  lookupCachedAnswer,
  storeAnswer,
} from '@/lib/copilot/qa-cache';

/**
 * POST /api/copilot — in-app helper chat.
 *
 * Free for every subscriber (no credit burn — retention feature, the
 * operator pays for Gemini), so cost control is structural instead:
 *  1. a deterministic tour-intent matcher answers the most common
 *     "how do I X?" questions with ZERO model calls, and
 *  2. two rate limits bound what's left (per-user burst + per-account
 *     daily backstop).
 */

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface CopilotRequest {
  message?: unknown;
  pathname?: unknown;
  history?: unknown;
}

const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY_TURNS = 6;

function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is ChatTurn =>
        !!t &&
        typeof t === 'object' &&
        (t.role === 'user' || t.role === 'assistant') &&
        typeof t.text === 'string',
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_MESSAGE_CHARS) }));
}

/** Gemini JSON mode still occasionally wraps output in ``` fences. */
function parseModelJson(raw: string): {
  reply?: unknown;
  tourId?: unknown;
  navigateTo?: unknown;
} | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount();

    const userLimit = checkRateLimit(
      `copilot:u:${ctx.userId}`,
      RATE_LIMITS.copilotChat,
    );
    if (!userLimit.success) return rateLimitResponse(userLimit);
    const accountLimit = checkRateLimit(
      `copilot:a:${ctx.accountId}`,
      RATE_LIMITS.copilotChatDaily,
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const body = (await req.json().catch(() => ({}))) as CopilotRequest;
    const message =
      typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        { error: 'message must be 1-500 characters' },
        { status: 400 },
      );
    }
    const pathname =
      typeof body.pathname === 'string' ? body.pathname.slice(0, 100) : '/';
    const history = sanitizeHistory(body.history);

    // Deterministic short-circuit — zero Gemini calls for tour asks.
    const tourId = matchTourIntent(message);
    if (tourId) {
      const tour = getTour(tourId)!;
      return NextResponse.json({
        reply: cannedTourReply(tour.title),
        tourId,
      });
    }

    // Widget still works on deployments without a Gemini key.
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({
        reply:
          'I can walk you through things step by step — tap one of the guides below! (AI answers are not set up on this server yet.)',
      });
    }

    // Self-learning cache: a similar generic question answered before
    // (for ANY user) is served from the learned store — deterministic
    // validation only, no Gemini call. Best-effort: every cache
    // failure falls through to the normal path below.
    const cacheable = isCacheableQuestion(message, history.length);
    let lookupEmbedding: number[] | null = null;
    if (cacheable) {
      const { entry, embedding } = await lookupCachedAnswer(message);
      lookupEmbedding = embedding;
      if (entry) {
        bumpHit(entry.id);
        return NextResponse.json({
          reply: entry.reply,
          ...(entry.tourId ? { tourId: entry.tourId } : {}),
          ...(entry.navigateTo ? { navigateTo: entry.navigateTo } : {}),
          cached: true,
          cacheId: entry.id,
        });
      }
    }

    const transcript = history
      .map((t) => `${t.role === 'user' ? 'User' : 'Helper'}: ${t.text}`)
      .join('\n');
    const prompt = transcript
      ? `${transcript}\nUser: ${message}`
      : `User: ${message}`;

    const raw = await generateJson(prompt, buildCopilotSystemPrompt(pathname), { feature: 'copilot' });
    const parsed = parseModelJson(raw);

    const reply =
      parsed && typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.slice(0, 1000)
        : raw.slice(0, 1000);

    // Sanitize model-suggested actions against real registries — the
    // client must never receive a tour id or route we don't own.
    const safeTourId =
      parsed && typeof parsed.tourId === 'string' && getTour(parsed.tourId)
        ? parsed.tourId
        : undefined;
    const safeNavigate =
      parsed &&
      typeof parsed.navigateTo === 'string' &&
      isAllowedRoute(parsed.navigateTo)
        ? parsed.navigateTo
        : undefined;

    // Learn this answer: only clean, parseable replies to cacheable
    // questions enter the shared store (reuses the lookup embedding —
    // no second embed call).
    let cacheId: string | null = null;
    if (
      cacheable &&
      lookupEmbedding &&
      parsed &&
      typeof parsed.reply === 'string' &&
      parsed.reply.trim()
    ) {
      cacheId = await storeAnswer({
        question: message,
        embedding: lookupEmbedding,
        reply,
        tourId: safeTourId,
        navigateTo: safeNavigate,
      });
    }

    return NextResponse.json({
      reply,
      ...(safeTourId ? { tourId: safeTourId } : {}),
      ...(safeNavigate ? { navigateTo: safeNavigate } : {}),
      ...(cacheId ? { cacheId } : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
