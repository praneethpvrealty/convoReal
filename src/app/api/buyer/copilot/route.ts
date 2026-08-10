import { NextResponse } from 'next/server';
import { withBuyerAuth } from '@/lib/buyer/auth';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { answerQuestion } from '@/lib/copilot/engine';
import { readChatRequest } from '@/lib/copilot/request';

/**
 * POST /api/buyer/copilot — helper chat for the buyer Portfolio.
 *
 * Mirror of the owner route: same engine, buyer audience. Retrieval
 * and the answer cache are partitioned by audience, so a buyer can
 * only be answered out of the buyer corpus — never the owner's or the
 * agency's.
 *
 * Like the owner route this answers questions about how Portfolio
 * works and reads no buyer data, so there is no BuyerContext scoping
 * on a query; the context supplies identity and the agency to
 * attribute unmet demand to.
 */
export const POST = withBuyerAuth(async (ctx, req) => {
  const burst = checkRateLimit(
    `copilot-buyer:u:${ctx.buyerUserId}`,
    RATE_LIMITS.copilotChat
  );
  if (!burst.success) return rateLimitResponse(burst);
  const daily = checkRateLimit(
    `copilot-buyer:d:${ctx.buyerUserId}`,
    RATE_LIMITS.copilotPortalDaily
  );
  if (!daily.success) return rateLimitResponse(daily);

  const parsed = readChatRequest(await req.json().catch(() => ({})));
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await answerQuestion({
    audience: 'buyer',
    accountId: ctx.links[0]?.accountId ?? null,
    ...parsed,
  });
  return NextResponse.json(result);
});
