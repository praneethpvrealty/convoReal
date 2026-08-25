import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { shareInventoryWithAgent } from '@/lib/inventory/agent-account-share';
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
      `agent:shareInventoryAccount:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const [{ id }, body] = await Promise.all([
      params,
      request.json().catch(() => null),
    ]);
    const contactId =
      typeof body?.contact_id === 'string' ? body.contact_id : '';
    if (!id || !contactId) {
      return NextResponse.json(
        { error: 'Property and agent contact are required' },
        { status: 400 }
      );
    }

    const result = await shareInventoryWithAgent(ctx, contactId, [id]);
    if (!result.registered) {
      return NextResponse.json(
        {
          error: `${result.recipientName} does not have a separate ConvoReal account yet`,
        },
        { status: 404 }
      );
    }
    if (result.sharedCount === 0) {
      return NextResponse.json(
        { error: 'This property is already shared with that agent' },
        { status: 409 }
      );
    }
    return NextResponse.json({ data: result.pending[0] }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
