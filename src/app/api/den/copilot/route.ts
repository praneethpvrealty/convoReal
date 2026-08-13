import { NextResponse } from 'next/server';
import { withDenAuth } from '@/lib/den/auth';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { answerQuestion } from '@/lib/copilot/engine';
import { logCopilotEvent } from '@/lib/copilot/events';
import { readChatRequest } from '@/lib/copilot/request';

/**
 * POST /api/den/copilot — helper chat for the owner Portfolio.
 *
 * Same engine as the staff route, different audience: retrieval and
 * the answer cache are partitioned by audience, so an owner can only
 * ever be answered out of the owner corpus (chunks.ts) — no Engine
 * page, tour or agent feature can leak into a reply here.
 *
 * The helper reads nothing owner-specific: it answers questions about
 * how Portfolio works, never about this owner's properties. That is
 * why there is no DenContext scoping on a data query — there is no
 * data query. The context is used for identity (rate-limit key) and
 * to attribute unmet demand to the managing agency.
 */
export const POST = withDenAuth(async (ctx, req) => {
  const burst = await checkRateLimit(
    `copilot-den:u:${ctx.denUserId}`,
    RATE_LIMITS.copilotChat
  );
  if (!burst.success) return rateLimitResponse(burst);
  const daily = await checkRateLimit(
    `copilot-den:d:${ctx.denUserId}`,
    RATE_LIMITS.copilotPortalDaily
  );
  if (!daily.success) return rateLimitResponse(daily);

  const parsed = readChatRequest(await req.json().catch(() => ({})));
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const accountId = ctx.links[0]?.accountId ?? null;
  const result = await answerQuestion({
    audience: 'owner',
    // Demand is filed against the agency that manages this owner. A
    // brand-new owner with no links yet has nobody to attribute to,
    // so their request is skipped rather than guessed at.
    accountId,
    ...parsed,
  });
  logCopilotEvent({
    accountId,
    audience: 'owner',
    event: 'chat',
    cached: result.cached,
  });
  return NextResponse.json(result);
});
