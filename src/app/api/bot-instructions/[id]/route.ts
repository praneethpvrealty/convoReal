import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const limit = await checkRateLimit(
      `bot-instructions:update:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
    } | null;
    if (body?.status !== 'active' && body?.status !== 'paused') {
      return NextResponse.json(
        { error: 'Status must be active or paused' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('bot_instructions')
      .update({ status: body.status, updated_by: ctx.userId })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
