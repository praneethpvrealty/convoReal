import { NextRequest, NextResponse } from 'next/server';
import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  disableSellerPage,
  enableSellerPage,
  getSellerPageStatus,
  SellerPageContactNotFoundError,
} from '@/lib/contacts/seller-page';

type RouteParams = { params: Promise<{ id: string }> };

function failure(err: unknown, label: string) {
  if (err instanceof SellerPageContactNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  console.error(`[${label} /api/contacts/[id]/seller-page]`, err);
  return toErrorResponse(err);
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await requireRole('agent');
    return NextResponse.json({
      data: await getSellerPageStatus(ctx.supabase, ctx.accountId, id),
    });
  } catch (err) {
    return failure(err, 'GET');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await requireWriteRole('agent');
    const limit = await checkRateLimit(
      `contact:seller-page:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({
      data: await enableSellerPage(ctx.supabase, ctx.accountId, id, {
        rotate: body?.rotate === true,
      }),
    });
  } catch (err) {
    return failure(err, 'POST');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await requireWriteRole('agent');
    const limit = await checkRateLimit(
      `contact:seller-page:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    return NextResponse.json({
      data: await disableSellerPage(ctx.supabase, ctx.accountId, id),
    });
  } catch (err) {
    return failure(err, 'DELETE');
  }
}
