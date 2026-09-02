import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { searchEntitySuggestions } from '@/lib/copilot/entity-search';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const limit = await checkRateLimit(
      `copilot:entities:${ctx.userId}`,
      RATE_LIMITS.copilotEntitySearch
    );
    if (!limit.success) return rateLimitResponse(limit);

    const symbol = request.nextUrl.searchParams.get('symbol') ?? '';
    const query = request.nextUrl.searchParams.get('q') ?? '';
    const data = await searchEntitySuggestions(ctx, symbol, query);
    return NextResponse.json({ data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
