import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { respondToRequirementAccountShare } from '@/lib/requirements/account-share';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const limit = await checkRateLimit(
      `requirement-account-share-response:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const [{ id }, body] = await Promise.all([
      params,
      request.json().catch(() => null),
    ]);
    const propertyIds = Array.isArray(body?.property_ids)
      ? body.property_ids.filter(
          (value: unknown): value is string => typeof value === 'string'
        )
      : [];
    const note = typeof body?.note === 'string' ? body.note : null;
    return NextResponse.json({
      data: await respondToRequirementAccountShare(
        ctx,
        id,
        propertyIds,
        note
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
