import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { answerQuestion } from '@/lib/copilot/engine';
import { logCopilotEvent } from '@/lib/copilot/events';
import { readChatRequest } from '@/lib/copilot/request';

/**
 * POST /api/copilot — in-app helper chat for agency staff.
 *
 * Auth and rate limits live here; the answer itself comes from the
 * shared engine (src/lib/copilot/engine.ts), which the two Portfolio
 * routes use as well.
 *
 * Free for every subscriber (no credit burn — retention feature, the
 * operator pays for Gemini), so cost control is structural: the
 * engine's tour matcher and semantic cache absorb most questions, and
 * two rate limits bound what's left (per-user burst + per-account
 * daily backstop).
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount();

    const userLimit = checkRateLimit(
      `copilot:u:${ctx.userId}`,
      RATE_LIMITS.copilotChat
    );
    if (!userLimit.success) return rateLimitResponse(userLimit);
    const accountLimit = checkRateLimit(
      `copilot:a:${ctx.accountId}`,
      RATE_LIMITS.copilotChatDaily
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const parsed = readChatRequest(await req.json().catch(() => ({})));
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await answerQuestion({
      audience: 'agent',
      accountId: ctx.accountId,
      ...parsed,
    });
    logCopilotEvent({
      accountId: ctx.accountId,
      userId: ctx.userId,
      platform: parsed.platform,
      event: 'chat',
      tourId: result.tourId,
      coverage: result.coverage,
      cached: result.cached,
    });
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
