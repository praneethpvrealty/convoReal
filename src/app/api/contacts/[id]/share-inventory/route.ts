import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  lookupAgentShareTarget,
  shareInventoryWithAgent,
} from '@/lib/inventory/agent-account-share';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const target = await lookupAgentShareTarget(ctx, id);
    return NextResponse.json({
      data: {
        registered: Boolean(target.recipient),
        recipientName: target.contact.name || 'This agent',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const limit = await checkRateLimit(
      `agent:shareContactInventory:${ctx.userId}`,
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
    const data = await shareInventoryWithAgent(ctx, id, propertyIds);
    return NextResponse.json({ data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
