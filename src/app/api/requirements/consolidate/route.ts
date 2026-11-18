import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { generateJson } from '@/lib/ai/gemini';
import { hasGeminiKey } from '@/lib/ai/gemini-keys';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  CONSOLIDATION_MAX_BRIEFS,
  CONSOLIDATION_MIN_BRIEFS,
  CONSOLIDATION_SYSTEM_INSTRUCTION,
  consolidationInputs,
  consolidationPrompt,
  formatConsolidatedDigest,
  mergedCount,
  sanitizeConsolidation,
} from '@/lib/requirements/consolidate';

function parseJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const userLimit = await checkRateLimit(
      `requirementConsolidate:u:${ctx.userId}`,
      RATE_LIMITS.copilotChat
    );
    if (!userLimit.success) return rateLimitResponse(userLimit);
    const accountLimit = await checkRateLimit(
      `requirementConsolidate:a:${ctx.accountId}`,
      RATE_LIMITS.copilotChatDaily
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const body = (await request.json().catch(() => null)) as {
      briefs?: unknown;
    } | null;
    if (
      Array.isArray(body?.briefs) &&
      body.briefs.length > CONSOLIDATION_MAX_BRIEFS
    ) {
      return NextResponse.json(
        {
          error: `Consolidate up to ${CONSOLIDATION_MAX_BRIEFS} requirements at a time`,
        },
        { status: 400 }
      );
    }
    const inputs = consolidationInputs(body?.briefs);
    if (inputs.length < CONSOLIDATION_MIN_BRIEFS) {
      return NextResponse.json(
        { error: 'Pick at least two requirements to consolidate' },
        { status: 400 }
      );
    }

    if (!(await hasGeminiKey())) {
      return NextResponse.json(
        { error: 'AI is not set up on this workspace yet' },
        { status: 503 }
      );
    }

    const raw = await generateJson(
      consolidationPrompt(inputs),
      CONSOLIDATION_SYSTEM_INSTRUCTION,
      { feature: 'requirement_consolidate', maxOutputTokens: 8192 }
    );
    const parsed = parseJson(raw);
    if (!parsed) {
      return NextResponse.json(
        { error: 'AI returned an unreadable answer. Please try again.' },
        { status: 502 }
      );
    }

    const groups = sanitizeConsolidation(parsed, inputs);
    return NextResponse.json({
      data: {
        text: formatConsolidatedDigest(groups),
        briefs: inputs.length,
        groups: groups.length,
        merged: mergedCount(groups),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
