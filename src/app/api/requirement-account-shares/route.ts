import { NextRequest, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  listRequirementAccountShares,
  shareRequirementWithAgent,
} from '@/lib/requirements/account-share';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const box =
      new URL(request.url).searchParams.get('box') === 'sent'
        ? 'sent'
        : 'received';
    return NextResponse.json({
      data: await listRequirementAccountShares(ctx, box),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = await checkRateLimit(
      `requirement-account-shares:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const contactId =
      typeof body?.contact_id === 'string' ? body.contact_id : '';
    const recipientContactId =
      typeof body?.recipient_contact_id === 'string'
        ? body.recipient_contact_id
        : '';
    if (!contactId || !recipientContactId) {
      return NextResponse.json(
        { error: 'Buyer requirement and receiving agent are required' },
        { status: 400 }
      );
    }

    const result = await shareRequirementWithAgent(
      ctx,
      contactId,
      recipientContactId
    );
    if (!result.registered) {
      return NextResponse.json(
        {
          error: `${result.recipientName} does not have a separate ConvoReal account yet`,
          code: 'AGENT_NOT_REGISTERED',
        },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { data: result },
      { status: result.alreadyShared ? 200 : 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
